import { execFile, spawn } from "node:child_process"
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { promisify } from "node:util"

import { Plugin } from "@opencode-ai/plugin/tui"

import { acquireWizardLease, wizardHostID } from "./host"
import {
  destinationLabel,
  parseWizardPublication,
  type WizardCapture,
  type WizardDefinition,
  type WizardDestination,
  type WizardPublication,
  type WizardStage,
  WIZARD_RUN_METADATA_KEY,
  wizardMinutes,
} from "./schema"

const execFileAsync = promisify(execFile)

interface PublishedWizard {
  publication: WizardPublication
}

interface WizardRun {
  status: "in-progress" | "completed" | "needs-attention"
  completedStages: string[]
  completedCaptures: string[]
  completedDestinations: string[]
  writes: string[]
  skipped: string[]
  startedAt: number
  updatedAt: number
  finishedAt?: number
}

interface WizardState {
  runs: Record<string, WizardRun>
}

type UpdateState = (mutation: (draft: WizardState) => void) => Promise<void>

type WizardContext = Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0]

type CaptureResult = "completed" | "skipped" | "stopped"

function runKey(sessionID: string, publicationID: string): string {
  return `${sessionID}/${publicationID}`
}

function newRun(): WizardRun {
  const now = Date.now()
  return {
    status: "in-progress",
    completedStages: [],
    completedCaptures: [],
    completedDestinations: [],
    writes: [],
    skipped: [],
    startedAt: now,
    updatedAt: now,
  }
}

function activeSessionID(context: WizardContext): string | undefined {
  const route = context.ui.router.current()
  return route.type === "session" ? route.sessionID : undefined
}

function stageMessage(
  definition: WizardDefinition,
  stage: WizardStage,
  index: number,
  run: WizardRun,
): string {
  const remaining = definition.stages
    .filter((item) => !run.completedStages.includes(item.id))
    .reduce((total, item) => total + item.estimateMinutes, 0)
  const instructions = stage.instructions.map(
    (instruction, itemIndex) => `${itemIndex + 1}. ${instruction}`,
  )
  const writes = stage.captures.flatMap((capture) =>
    capture.destinations.map(
      (destination) => `Pending  ${destinationLabel(destination)}`,
    ),
  )

  return [
    `Stage ${index + 1} of ${definition.stages.length} · about ${remaining} min left`,
    "",
    stage.intro,
    stage.url === undefined ? undefined : `URL: ${stage.url}`,
    instructions.length === 0 ? undefined : `\n${instructions.join("\n")}`,
    writes.length === 0 ? undefined : `\nWrites\n${writes.join("\n")}`,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync("which", [command], { timeout: 3_000 })
    return true
  } catch {
    return false
  }
}

async function openURL(url: string): Promise<boolean> {
  let command: string | undefined
  if (process.platform === "darwin") command = "open"
  if (process.platform === "linux" && process.env.WSL_DISTRO_NAME !== undefined)
    command = "explorer.exe"
  if (process.platform === "linux" && process.env.WSL_DISTRO_NAME === undefined)
    command = "xdg-open"
  if (command === undefined || !(await commandExists(command))) return false

  return new Promise<boolean>((complete) => {
    const child = spawn(command, [url], {
      detached: true,
      stdio: "ignore",
      shell: false,
    })
    child.once("spawn", () => {
      child.unref()
      complete(true)
    })
    child.once("error", () => complete(false))
  })
}

function parseEnvAssignment(
  line: string,
  key: string,
): { matches: false } | { matches: true; value: string } {
  const match = line.match(
    /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/,
  )
  if (match?.[1] !== key) return { matches: false }

  const raw = match[2]
  const singleQuoted = raw.match(/^'([^']*)'\s*(?:#.*)?$/)
  if (singleQuoted !== null) return { matches: true, value: singleQuoted[1] }
  const doubleQuoted = raw.match(/^"([^"\\]*)"\s*(?:#.*)?$/)
  if (doubleQuoted !== null) return { matches: true, value: doubleQuoted[1] }
  if (raw.startsWith("'") || raw.startsWith('"')) {
    throw new Error(
      `Existing ${key} uses unsupported .env quote or escape syntax.`,
    )
  }
  return { matches: true, value: raw.split("#", 1)[0].trimEnd() }
}

async function existingEnvValue(
  root: string,
  capture: WizardCapture,
): Promise<string | undefined> {
  for (const destination of capture.destinations) {
    if (destination.kind !== "env") continue
    try {
      const path = await safeEnvPath(root, destination.file)
      const content = await readFile(path, "utf8")
      let value: string | undefined
      for (const line of content.split(/\r?\n/)) {
        const assignment = parseEnvAssignment(line, destination.key)
        if (assignment.matches) value = assignment.value
      }
      if (value === undefined) continue
      if (value.length > 0) return value
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "ENOENT") throw error
    }
  }
  return undefined
}

function isInside(root: string, target: string): boolean {
  const path = relative(root, target)
  return (
    path === "" ||
    (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
  )
}

async function safeEnvPath(root: string, file: string): Promise<string> {
  if (
    isAbsolute(file) ||
    /^[A-Za-z]:[\\/]/.test(file) ||
    file.split(/[\\/]/).some((part) => part === "..")
  ) {
    throw new Error("Environment file must stay inside the active project.")
  }

  const projectRoot = await realpath(root)
  const target = resolve(projectRoot, file)
  if (!isInside(projectRoot, target))
    throw new Error("Environment file is outside the active project.")

  const parent = await realpath(dirname(target))
  if (!isInside(projectRoot, parent))
    throw new Error("Environment file parent is outside the active project.")

  try {
    const info = await lstat(target)
    if (info.isSymbolicLink())
      throw new Error("Environment file cannot be a symbolic link.")
    const existing = await realpath(target)
    if (!isInside(projectRoot, existing))
      throw new Error("Environment file is outside the active project.")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }

  return target
}

function encodeEnvValue(value: string): string {
  if (
    !/[\s#]/.test(value) &&
    !(value.startsWith("'") && value.endsWith("'")) &&
    !(value.startsWith('"') && value.endsWith('"'))
  ) {
    return value
  }
  if (!value.includes("'")) return `'${value}'`
  if (!/["\\$`]/.test(value)) return `"${value}"`
  throw new Error(
    "This value cannot be represented safely in a portable .env file. Use the service's file-based secret format instead.",
  )
}

async function writeEnvironmentValue(
  root: string,
  destination: Extract<WizardDestination, { kind: "env" }>,
  value: string,
  secret: boolean,
): Promise<void> {
  const path = await safeEnvPath(root, destination.file)
  await withFileLock(path, async () => {
    let content = ""
    let mode = secret ? 0o600 : 0o644

    try {
      content = await readFile(path, "utf8")
      const existingMode = (await stat(path)).mode & 0o777
      mode = secret ? 0o600 : existingMode
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }

    const lines = content
      .split(/\r?\n/)
      .filter((line) => !parseEnvAssignment(line, destination.key).matches)
    while (lines.at(-1) === "") lines.pop()
    lines.push(`${destination.key}=${encodeEnvValue(value)}`)
    const temp = join(
      dirname(path),
      `.${destination.file.split(/[\\/]/).at(-1)}.${process.pid}.${Date.now()}.tmp`,
    )

    try {
      await writeFile(temp, `${lines.join("\n")}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode,
      })
      await chmod(temp, mode)
      await rename(temp, path)
    } catch (error) {
      await unlink(temp).catch(() => undefined)
      throw error
    }
  })
}

async function withFileLock<Value>(
  path: string,
  action: () => Promise<Value>,
): Promise<Value> {
  const lock = `${path}.wizard.lock`
  const deadline = Date.now() + 5_000
  while (true) {
    try {
      await mkdir(lock, { mode: 0o700 })
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      try {
        if (Date.now() - (await stat(lock)).mtimeMs > 30_000) {
          await rmdir(lock)
          continue
        }
      } catch (staleError) {
        if ((staleError as NodeJS.ErrnoException).code !== "ENOENT")
          throw staleError
      }
      if (Date.now() >= deadline)
        throw new Error(`Timed out waiting to update ${path}.`)
      await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    }
  }

  try {
    return await action()
  } finally {
    await rmdir(lock).catch(() => undefined)
  }
}

async function runGh(
  args: string[],
  root: string,
  input?: string,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("gh", args, {
      cwd: root,
      shell: false,
      stdio: ["pipe", "ignore", "pipe"],
    })
    let errorText = ""
    let settled = false
    const complete = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error === undefined) resolvePromise()
      else reject(error)
    }
    const timeout = setTimeout(() => {
      child.kill("SIGTERM")
      setTimeout(() => child.kill("SIGKILL"), 1_000).unref()
      complete(new Error("GitHub CLI timed out after 30 seconds."))
    }, 30_000)
    timeout.unref()
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      if (errorText.length < 500)
        errorText += chunk.slice(0, 500 - errorText.length)
    })
    child.on("error", (error) => complete(error))
    child.on("close", (code) => {
      if (code === 0) {
        complete()
        return
      }
      complete(
        new Error(
          errorText.trim() || `gh exited with status ${code ?? "unknown"}.`,
        ),
      )
    })
    child.stdin.on("error", () => undefined)
    child.stdin.end(input)
  })
}

async function resolveGitHubRepository(root: string): Promise<string> {
  const result = await execFileAsync(
    "gh",
    ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
    { cwd: root, timeout: 10_000, maxBuffer: 1024 * 1024 },
  )
  const repository = result.stdout.trim()
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    throw new Error("GitHub CLI did not resolve a repository.")
  }
  return repository
}

async function applyDestination(
  root: string,
  destination: WizardDestination,
  value: string,
  secret: boolean,
  githubRepository?: string,
): Promise<void> {
  if (destination.kind === "env") {
    await writeEnvironmentValue(root, destination, value, secret)
    return
  }
  if (githubRepository === undefined) {
    throw new Error("GitHub repository was not resolved.")
  }
  if (destination.kind === "github-secret") {
    await runGh(
      ["secret", "set", destination.name, "--repo", githubRepository],
      root,
      value,
    )
    return
  }
  await runGh(
    [
      "variable",
      "set",
      destination.name,
      "--body",
      value,
      "--repo",
      githubRepository,
    ],
    root,
  )
}

function secretScript(): string {
  return [
    "on run argv",
    "set dialogTitle to item 1 of argv",
    "set dialogText to item 2 of argv",
    'set answer to display dialog dialogText default answer "" with title dialogTitle with hidden answer buttons {"Cancel", "Continue"} default button "Continue" cancel button "Cancel"',
    "return text returned of answer",
    "end run",
  ].join("\n")
}

async function promptSecret(
  context: WizardContext,
  title: string,
  label: string,
): Promise<string | undefined> {
  let helper: "osascript" | "zenity" | "kdialog" | undefined
  try {
    if (process.platform === "darwin" && (await commandExists("osascript"))) {
      helper = "osascript"
      const result = await execFileAsync(
        "osascript",
        ["-e", secretScript(), title, label],
        {
          maxBuffer: 1024 * 1024,
        },
      )
      return result.stdout.replace(/\r?\n$/, "")
    }
    if (process.platform === "linux" && (await commandExists("zenity"))) {
      helper = "zenity"
      const result = await execFileAsync(
        "zenity",
        ["--password", `--title=${title}`, `--text=${label}`],
        { maxBuffer: 1024 * 1024 },
      )
      return result.stdout.replace(/\r?\n$/, "")
    }
    if (process.platform === "linux" && (await commandExists("kdialog"))) {
      helper = "kdialog"
      const result = await execFileAsync(
        "kdialog",
        ["--password", label, "--title", title],
        {
          maxBuffer: 1024 * 1024,
        },
      )
      return result.stdout.replace(/\r?\n$/, "")
    }
  } catch (error) {
    const failure = error as { code?: unknown; stderr?: unknown }
    const stderr = typeof failure.stderr === "string" ? failure.stderr : ""
    const cancelled =
      failure.code === 1 &&
      (helper !== "osascript" || /cancel(?:led|ed)/i.test(stderr))
    if (!cancelled) {
      await context.ui.dialog.alert({
        title: "Secret input failed",
        message:
          "The hidden-input helper failed. The secret was not captured. Fix the desktop helper and resume the wizard.",
      })
    }
    return undefined
  }

  await context.ui.dialog.alert({
    title: "Secret input unavailable",
    message:
      "This terminal has no supported hidden-input dialog. Install zenity or kdialog on Linux. Secret values will not use a visible prompt.",
  })
  return undefined
}

function valueError(capture: WizardCapture, value: string): string | undefined {
  if (value.length === 0) return "The value cannot be empty."
  if (value.includes("\0") || value.includes("\n") || value.includes("\r")) {
    return "The value must fit on one line."
  }
  if (capture.prefix !== undefined && !value.startsWith(capture.prefix)) {
    return `The value must start with ${capture.prefix}.`
  }
  return undefined
}

async function promptValue(
  context: WizardContext,
  definition: WizardDefinition,
  capture: WizardCapture,
) {
  while (true) {
    const value =
      capture.sensitivity === "secret"
        ? await promptSecret(context, definition.title, capture.label)
        : await context.ui.dialog.prompt({
            title: capture.label,
            description: capture.hint,
            placeholder:
              capture.prefix === undefined
                ? "Paste the value"
                : `Starts with ${capture.prefix}`,
          })
    if (value === undefined) return undefined
    const error = valueError(capture, value)
    if (error === undefined) return value
    await context.ui.dialog.alert({ title: "Invalid value", message: error })
  }
}

async function appendRunItem(
  updateState: UpdateState,
  key: string,
  field: "completedStages" | "completedCaptures" | "writes" | "skipped",
  value: string,
): Promise<void> {
  await updateState((draft) => {
    const run = draft.runs[key]
    if (!run[field].includes(value)) run[field].push(value)
    run.updatedAt = Date.now()
  })
}

async function markDestinationWritten(
  updateState: UpdateState,
  key: string,
  destinationID: string,
  label: string,
): Promise<void> {
  await updateState((draft) => {
    const run = draft.runs[key]
    run.completedDestinations ??= []
    if (!run.completedDestinations.includes(destinationID)) {
      run.completedDestinations.push(destinationID)
    }
    if (!run.writes.includes(label)) run.writes.push(label)
    run.skipped = run.skipped.filter((item) => item !== label)
    run.updatedAt = Date.now()
  })
}

async function captureValue(
  context: WizardContext,
  state: WizardState,
  definition: WizardDefinition,
  capture: WizardCapture,
  root: string,
  key: string,
  updateState: UpdateState,
  githubRepository?: string,
): Promise<CaptureResult> {
  let value: string | undefined
  let skipped = false

  try {
    const completedDestinations = state.runs[key].completedDestinations ?? []
    const pendingDestinations = capture.destinations
      .map((destination, index) => ({
        destination,
        id: `${capture.id}/${index}`,
      }))
      .filter((item) => !completedDestinations.includes(item.id))
    if (pendingDestinations.length === 0) {
      await appendRunItem(updateState, key, "completedCaptures", capture.id)
      return "completed"
    }

    const existing = await existingEnvValue(root, capture)
    if (existing !== undefined && valueError(capture, existing) === undefined) {
      const choice = await context.ui.dialog.select({
        title: capture.label,
        current: "keep",
        options: [
          {
            title: "Keep existing value",
            description:
              capture.sensitivity === "secret"
                ? "Use the hidden value already stored in the environment file"
                : "Use the value already stored in the environment file",
            value: "keep",
          },
          { title: "Replace value", value: "replace" },
          { title: "Save and exit", value: "exit" },
        ],
      })
      if (choice === undefined || choice === "exit") return "stopped"
      if (choice === "keep") value = existing
    }

    if (value === undefined)
      value = await promptValue(context, definition, capture)
    if (value === undefined) return "stopped"

    for (const { destination, id: destinationID } of pendingDestinations) {
      const label = destinationLabel(destination)
      if (destination.kind !== "env") {
        const confirmed = await context.ui.dialog.confirm({
          title: "Confirm GitHub write",
          message: `Set ${label} in ${githubRepository ?? "an unresolved repository"}? This replaces the existing value if the name already exists.`,
          label: { confirm: "Set value", cancel: "Save and exit" },
        })
        if (confirmed !== true) return "stopped"
      }
      while (true) {
        try {
          await applyDestination(
            root,
            destination,
            value,
            capture.sensitivity === "secret",
            githubRepository,
          )
          await markDestinationWritten(updateState, key, destinationID, label)
          break
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const choice = await context.ui.dialog.select({
            title: `Could not write ${label}`,
            options: [
              {
                title: "Retry",
                description: message.slice(0, 300),
                value: "retry",
              },
              { title: "Skip for now", value: "skip" },
              { title: "Save and exit", value: "exit" },
            ],
          })
          if (choice === "retry") continue
          if (choice === "skip") {
            await appendRunItem(updateState, key, "skipped", label)
            skipped = true
            break
          }
          return "stopped"
        }
      }
    }

    if (skipped) return "skipped"
    await appendRunItem(updateState, key, "completedCaptures", capture.id)
    return "completed"
  } finally {
    value = undefined
  }
}

async function prepareRun(
  context: WizardContext,
  state: WizardState,
  updateState: UpdateState,
  key: string,
): Promise<WizardRun | undefined> {
  const existing = state.runs[key]
  if (existing === undefined) {
    await updateState((draft) => {
      draft.runs[key] = newRun()
    })
    return state.runs[key]
  }

  const choice = await context.ui.dialog.select({
    title:
      existing.status === "completed" ? "Run wizard again" : "Resume wizard",
    current: existing.status === "completed" ? "restart" : "resume",
    options: [
      ...(existing.status !== "completed"
        ? [
            {
              title: "Resume",
              description: "Continue at the first incomplete stage",
              value: "resume" as const,
            },
          ]
        : []),
      {
        title: "Start over",
        description: "Reset saved progress for this wizard",
        value: "restart" as const,
      },
      { title: "Cancel", value: "cancel" as const },
    ],
  })
  if (choice === undefined || choice === "cancel") return undefined
  if (choice === "restart") {
    await updateState((draft) => {
      draft.runs[key] = newRun()
    })
  }
  return state.runs[key]
}

async function runWizard(
  context: WizardContext,
  state: WizardState,
  updateState: UpdateState,
  sessionID: string,
  published: PublishedWizard,
): Promise<void> {
  const { definition, scope } = published.publication
  await context.data.session.sync(sessionID)
  const session = context.data.session.get(sessionID)
  const currentDirectory = session?.location.directory
  if (
    session === undefined ||
    session.projectID !== scope.projectID ||
    currentDirectory !== scope.directory ||
    session.subpath !== scope.subpath
  ) {
    await context.ui.dialog.alert({
      title: "Wizard location changed",
      message:
        "This wizard was published for a different project or session location. Ask the agent to publish it again from the current location.",
    })
    return
  }
  const localHostID = await wizardHostID()
  if (localHostID !== scope.hostID) {
    await context.ui.dialog.alert({
      title: "Remote wizard blocked",
      message:
        "This wizard was published on another host. Run it from a TUI on the same host as the OpenCode service.",
    })
    return
  }
  const root = resolve(scope.directory, scope.subpath ?? "")
  try {
    await realpath(root)
  } catch {
    await context.ui.dialog.alert({
      title: "Project is not local",
      message:
        "The wizard project directory is not available to this TUI. Native wizard writes require a local OpenCode session.",
    })
    return
  }

  const key = runKey(sessionID, published.publication.publicationID)
  let run = await prepareRun(context, state, updateState, key)
  if (run === undefined) return

  const usesGitHub = definition.stages.some((stage) =>
    stage.captures.some((capture) =>
      capture.destinations.some((destination) => destination.kind !== "env"),
    ),
  )
  let githubRepository: string | undefined
  if (usesGitHub) {
    try {
      githubRepository = await resolveGitHubRepository(root)
    } catch (error) {
      await context.ui.dialog.alert({
        title: "GitHub repository unavailable",
        message: error instanceof Error ? error.message : String(error),
      })
      return
    }
  }

  const start = await context.ui.dialog.confirm({
    title: definition.title,
    message: `${definition.summary}\n\n${definition.stages.length} stages · about ${wizardMinutes(definition)} minutes\nProject: ${context.ui.format.path(root)}${githubRepository === undefined ? "" : `\nGitHub: ${githubRepository}`}`,
    label: {
      confirm: run.completedStages.length === 0 ? "Start" : "Resume",
      cancel: "Cancel",
    },
  })
  if (start !== true) return

  for (const [index, stage] of definition.stages.entries()) {
    run = state.runs[key]
    if (run.completedStages.includes(stage.id)) continue

    if (stage.irreversible !== undefined) {
      const confirmed = await context.ui.dialog.confirm({
        title: `Confirm: ${stage.title}`,
        message: stage.irreversible,
        label: { confirm: "Continue", cancel: "Save and exit" },
      })
      if (confirmed !== true) return
    }

    await context.ui.dialog.alert({
      title: stage.title,
      message: stageMessage(definition, stage, index, run),
    })

    if (stage.url !== undefined) {
      const parsedURL = new URL(stage.url)
      const choice = await context.ui.dialog.select({
        title: `Open ${parsedURL.host}`,
        options: [
          {
            title: "Open in browser",
            description:
              parsedURL.protocol === "https:"
                ? stage.url
                : `Warning: unencrypted HTTP URL · ${stage.url}`,
            value: "open",
          },
          {
            title: "Continue without opening",
            description: "Open the displayed URL yourself",
            value: "continue",
          },
          { title: "Save and exit", value: "exit" },
        ],
      })
      if (choice === undefined || choice === "exit") return
      if (choice === "open" && !(await openURL(stage.url))) {
        await context.ui.dialog.alert({
          title: "Open this URL",
          message: `The browser could not open automatically. Open this URL manually:\n\n${stage.url}`,
        })
      }
    }

    let stageSkipped = false
    for (const capture of stage.captures) {
      run = state.runs[key]
      if (run.completedCaptures.includes(capture.id)) continue
      const result = await captureValue(
        context,
        state,
        definition,
        capture,
        root,
        key,
        updateState,
        githubRepository,
      )
      if (result === "stopped") return
      if (result === "skipped") stageSkipped = true
    }

    if (stage.captures.length === 0) {
      const completed = await context.ui.dialog.confirm({
        title: stage.title,
        message: "Did you complete this stage?",
        label: { confirm: "Mark complete", cancel: "Save and exit" },
      })
      if (completed !== true) return
    }

    if (!stageSkipped) {
      await appendRunItem(updateState, key, "completedStages", stage.id)
    }
  }

  await updateState((draft) => {
    const current = draft.runs[key]
    current.status =
      current.completedStages.length === definition.stages.length &&
      current.skipped.length === 0
        ? "completed"
        : "needs-attention"
    current.updatedAt = Date.now()
    current.finishedAt = Date.now()
  })
  run = state.runs[key]

  const summary = [
    run.status === "completed"
      ? "Setup complete."
      : "Setup finished with items that still need attention.",
    run.writes.length === 0
      ? undefined
      : `\nConfigured\n${run.writes.map((item) => `Success  ${item}`).join("\n")}`,
    run.skipped.length === 0
      ? undefined
      : `\nStill to do\n${run.skipped.map((item) => `Skipped  ${item}`).join("\n")}`,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")

  await context.ui.dialog.alert({ title: definition.title, message: summary })
}

export default Plugin.define({
  id: "local.wizard.tui",
  setup(context) {
    const [state, updateState] = context.storage.store("runs", {
      initial: { runs: {} } as WizardState,
    })

    let running = false
    const stopPublished = context.data.on("session.synthetic", (event) => {
      const parsed = parseWizardPublication(
        event.data.metadata?.[WIZARD_RUN_METADATA_KEY],
      )
      if (!parsed.ok) return
      if (activeSessionID(context) !== event.data.sessionID) {
        context.ui.toast.show({
          title: "Wizard waiting",
          message:
            "Open the requesting session, then ask the agent to resume the wizard.",
          variant: "warning",
        })
        return
      }
      if (running) {
        context.ui.toast.show({
          title: "Wizard already running",
          message: "Finish or exit the current wizard before starting another.",
          variant: "warning",
        })
        return
      }

      void (async () => {
        const lease = await acquireWizardLease(
          `${event.data.sessionID}/${parsed.publication.publicationID}`,
        )
        if (lease === undefined) {
          context.ui.toast.show({
            title: "Wizard already running",
            message: "Another TUI is running this wizard.",
            variant: "warning",
          })
          return
        }

        running = true
        try {
          await runWizard(
            context,
            state as unknown as WizardState,
            updateState,
            event.data.sessionID,
            { publication: parsed.publication },
          )
        } catch (error) {
          await context.ui.dialog.alert({
            title: "Wizard failed",
            message: error instanceof Error ? error.message : String(error),
          })
        } finally {
          running = false
          await lease()
        }
      })()
    })

    return stopPublished
  },
})
