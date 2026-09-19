import { lstat, readFile, readlink, realpath } from "node:fs/promises"
import * as path from "node:path"

export interface BucklerState {
  style_guide: string
  path: string
  tool: "write" | "edit"
  proposed_content: string
  existing_content?: string
  change?: { oldString: string; newString: string }
}

export interface BucklerLoadArgs {
  sessionDirectory: string
  projectCanonical: string
  guideOption?: unknown
  tool: string
  input: unknown
}

export interface GuideSection {
  heading: string
  body: string
}

const MAX_GUIDE_SECTIONS = 20

async function readNonEmptyFile(filePath: string): Promise<string | undefined> {
  let text: string
  try {
    text = await readFile(filePath, "utf8")
  } catch {
    return undefined
  }
  if (text.trim() === "") return undefined
  return text
}

function resolveAgainst(base: string, candidate: string): string {
  if (path.isAbsolute(candidate)) return path.normalize(candidate)
  return path.resolve(base, candidate)
}

function pathNotAllowedError(targetPath: string): Error {
  return new Error(
    `buckler: path not allowed: target is outside session and project roots (${targetPath}). Refusing to read or gate.`,
  )
}

function editNotReconstructableError(targetPath: string, detail: string): Error {
  return new Error(
    `buckler: edit not reconstructable: cannot reconstruct proposed content for gating (${targetPath}): ${detail}.`,
  )
}

async function canonicalRoot(root: string): Promise<string> {
  try {
    return await realpath(root)
  } catch {
    return path.resolve(root)
  }
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "ENOENT"
}

async function canonicalTarget(resolvedPath: string): Promise<string> {
  let stat: Awaited<ReturnType<typeof lstat>>
  try {
    stat = await lstat(resolvedPath)
  } catch (err) {
    if (!isEnoent(err)) throw pathNotAllowedError(resolvedPath)
    // New file (does not exist yet and is not a symlink): parent realpath + basename.
    const parent = path.dirname(resolvedPath)
    try {
      const realParent = await realpath(parent)
      return path.join(realParent, path.basename(resolvedPath))
    } catch {
      return resolvedPath
    }
  }
  if (stat.isSymbolicLink()) {
    // Jail the link destination, not the symlink's location. Fail closed
    // when the destination cannot be proven inside the jail.
    try {
      return await realpath(resolvedPath)
    } catch {
      // realpath failed (dangling or unreadable destination): follow the
      // symlink chain manually so a dangling/masked outside target cannot
      // fall back to parent+basename inside the session.
      let current: string
      try {
        const link = await readlink(resolvedPath)
        current = resolveAgainst(path.dirname(resolvedPath), link)
      } catch {
        throw pathNotAllowedError(resolvedPath)
      }
      for (let i = 0; i < 20; i++) {
        let currentStat: Awaited<ReturnType<typeof lstat>>
        try {
          currentStat = await lstat(current)
        } catch (err) {
          if (!isEnoent(err)) throw pathNotAllowedError(resolvedPath)
          try {
            const realParent = await realpath(path.dirname(current))
            return path.join(realParent, path.basename(current))
          } catch {
            throw pathNotAllowedError(resolvedPath)
          }
        }
        if (!currentStat.isSymbolicLink()) {
          try {
            return await realpath(current)
          } catch {
            throw pathNotAllowedError(resolvedPath)
          }
        }
        try {
          const next = await readlink(current)
          current = resolveAgainst(path.dirname(current), next)
        } catch {
          throw pathNotAllowedError(resolvedPath)
        }
      }
      throw pathNotAllowedError(resolvedPath)
    }
  }
  try {
    return await realpath(resolvedPath)
  } catch {
    throw pathNotAllowedError(resolvedPath)
  }
}

function isInsideRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

/** Split a style guide into at most 20 sections on `## ` headings. */
export function parseGuideSections(styleGuide: string): GuideSection[] {
  const sections: GuideSection[] = []
  const lines = styleGuide.split(/\r?\n/)
  let heading: string | undefined
  let body: string[] = []
  const flush = () => {
    if (heading !== undefined && sections.length < MAX_GUIDE_SECTIONS) {
      sections.push({ heading, body: body.join("\n").trim() })
    }
  }
  for (const line of lines) {
    const match = /^ {0,3}## (.*)$/.exec(line)
    if (match) {
      flush()
      if (sections.length >= MAX_GUIDE_SECTIONS) return sections
      heading = (match[1] ?? "").trim()
      body = []
    } else if (heading !== undefined) {
      if (sections.length >= MAX_GUIDE_SECTIONS) continue
      body.push(line)
    }
  }
  flush()
  return sections
}

/** Headings (`## `) of a style guide, capped at 20. Skips `#` and `###`+. */
export function parseGuideHeadings(styleGuide: string): string[] {
  return parseGuideSections(styleGuide).map((section) => section.heading)
}

/**
 * Resolve the guide, target path, and proposed content for a write/edit call.
 * Returns undefined when idle (missing guide, guide-self target,
 * non-write/edit, or un-applicable input before a guide is established).
 * Throws fail-closed once a guide is loaded: path outside the session/project
 * jail, or an edit that cannot be reconstructed with exact match/replaceAll.
 */
export async function loadBucklerState(args: BucklerLoadArgs): Promise<BucklerState | undefined> {
  const { sessionDirectory, projectCanonical, guideOption, tool, input } = args
  if (tool !== "write" && tool !== "edit") return undefined
  if (typeof sessionDirectory !== "string" || sessionDirectory === "") return undefined

  let guidePath: string | undefined
  let styleGuide: string | undefined
  try {
    if (typeof guideOption === "string" && guideOption.length > 0) {
      const candidate = resolveAgainst(sessionDirectory, guideOption)
      styleGuide = await readNonEmptyFile(candidate)
      if (styleGuide === undefined) return undefined
      guidePath = candidate
    } else {
      const candidates = [
        path.join(sessionDirectory, ".opencode", "code-style.md"),
        path.join(projectCanonical, ".opencode", "code-style.md"),
      ]
      for (const candidate of candidates) {
        if (guidePath !== undefined) break
        const text = await readNonEmptyFile(candidate)
        if (text === undefined) continue
        styleGuide = text
        guidePath = candidate
      }
      if (styleGuide === undefined || guidePath === undefined) return undefined
    }
  } catch {
    return undefined
  }

  if (typeof input !== "object" || input === null) return undefined
  const record = input as Record<string, unknown>
  const rawPath = record["path"] ?? record["filePath"]
  if (typeof rawPath !== "string" || rawPath.length === 0) return undefined
  const targetPath = resolveAgainst(sessionDirectory, rawPath)
  if (targetPath === guidePath) return undefined

  // Path jail: execute.before runs before OpenCode permission checks, so
  // never read the target or exfiltrate it to Jev when it escapes both roots.
  const [jailedTarget, sessionRoot] = await Promise.all([
    canonicalTarget(targetPath),
    canonicalRoot(sessionDirectory),
  ])
  const projectRoot =
    typeof projectCanonical === "string" && projectCanonical !== ""
      ? await canonicalRoot(projectCanonical)
      : undefined
  const insideSession = isInsideRoot(jailedTarget, sessionRoot)
  const insideProject = projectRoot !== undefined && isInsideRoot(jailedTarget, projectRoot)
  if (!insideSession && !insideProject) {
    throw pathNotAllowedError(targetPath)
  }

  if (tool === "write") {
    const content = record["content"]
    if (typeof content !== "string") return undefined
    return { style_guide: styleGuide, path: targetPath, tool: "write", proposed_content: content }
  }

  const oldString = record["oldString"]
  const newString = record["newString"]
  if (typeof oldString !== "string" || typeof newString !== "string") {
    throw editNotReconstructableError(targetPath, "missing oldString/newString")
  }
  if (oldString === "") {
    throw editNotReconstructableError(targetPath, "empty oldString")
  }
  let existing: string
  try {
    existing = await readFile(targetPath, "utf8")
  } catch {
    throw editNotReconstructableError(targetPath, "target file could not be read")
  }
  const matches = existing.split(oldString).length - 1
  if (matches === 0) {
    throw editNotReconstructableError(targetPath, "no exact match for oldString")
  }
  if (matches > 1 && record["replaceAll"] !== true) {
    throw editNotReconstructableError(targetPath, `ambiguous match (${matches} matches) without replaceAll`)
  }
  const proposed =
    record["replaceAll"] === true
      ? existing.split(oldString).join(newString)
      : existing.replace(oldString, newString)
  return {
    style_guide: styleGuide,
    path: targetPath,
    tool: "edit",
    proposed_content: proposed,
    existing_content: existing,
    change: { oldString, newString },
  }
}
