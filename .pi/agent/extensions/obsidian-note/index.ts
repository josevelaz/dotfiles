/**
 * `/note` — capture an idea into this repo's Obsidian note, with a model-written
 * summary of the surrounding conversation context.
 *
 * Usage accounting limitation: this extension calls `complete()` directly rather
 * than going through the session agent loop. Direct `complete()` calls bypass
 * Pi's session usage accounting, so the tokens spent by `/note` never appear in
 * the session footer, `/stats`, or the session cost totals. The per-note success
 * notification (`(<input>/<output> tokens)`) is the only place they surface.
 */

import { complete, type AssistantMessage, type Model, type UserMessage } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  buildNoteEvidence,
  buildNotePrompt,
  deriveNoteTarget,
  loadConfig,
  noteMessages,
  NOTE_SYSTEM_PROMPT,
  ObsidianWriteError,
  redactNotification,
  redactSecrets,
  renderNewNoteContent,
  renderNoteBlock,
  runObsidianWrite,
  validateSynthesis,
  type NoteConfig,
  type NoteRepoInfo,
  type NoteTarget,
} from "./core.ts";

const CONFIG_PATH = join(homedir(), ".pi", "agent", "obsidian-note.json");
const OBSIDIAN_TIMEOUT_MS = 15_000;
const GIT_TIMEOUT_MS = 5_000;

type NoteAuth = {
  apiKey?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
};

/** Git-derived facts plus the note destination they imply. */
type NotePreflight = {
  target: NoteTarget;
  repo: NoteRepoInfo;
};

type NoteJob = {
  id: number;
  idea: string;
  evidence: string;
  config: NoteConfig;
  cwd: string;
  model: Model<any>;
  auth: NoteAuth;
  ctx: ExtensionCommandContext;
  /** Resolves to the destination; never rejects. Also emits the start notice. */
  preflight: Promise<NotePreflight>;
};

/** Model-side failure; reported with the `model error` wording. */
class NoteModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoteModelError";
  }
}

export default function obsidianNoteExtension(pi: ExtensionAPI): void {
  // Per-instance state only. No background resources are started at factory
  // time and no tools are registered.
  const queue: NoteJob[] = [];
  const controllers = new Set<AbortController>();
  let running = false;
  let jobCounter = 0;

  /** Idempotent: repeated shutdown events abort nothing new and clear nothing new. */
  pi.on("session_shutdown", async () => {
    queue.length = 0;
    for (const controller of controllers) {
      controller.abort();
    }
    controllers.clear();
  });

  function notify(job: NoteJob, message: string, type: "info" | "warning" | "error"): void {
    notifyCtx(job.ctx, message, type);
  }

  function notifyCtx(
    ctx: ExtensionCommandContext,
    message: string,
    type: "info" | "warning" | "error",
  ): void {
    // Every notification is a sink for raw input, model text, or CLI output, so
    // redaction is enforced here rather than at each call site.
    const safe = redactNotification(message);
    // Post-await notifications may race a disposed UI (e.g. `/reload`).
    try {
      ctx.ui.notify(safe, type);
    } catch {
      // The session is gone; nothing left to tell.
    }
  }

  async function execObsidian(
    cmd: string,
    args: string[],
    signal: AbortSignal,
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    const result = await pi.exec(cmd, args, { signal, timeout: OBSIDIAN_TIMEOUT_MS });
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.code ?? 1 };
  }

  /**
   * Resolve the Git root, then branch and short SHA, using argv-only `git`
   * calls. Nothing inspects `.git` (or any repository path) through the
   * filesystem: a non-zero exit is the only non-Git signal, which feeds the
   * Task 2 `no-repo-<cwd>` fallback.
   */
  async function resolvePreflight(
    seed: Pick<NoteJob, "config" | "cwd">,
    signal: AbortSignal,
  ): Promise<NotePreflight> {
    const gitRoot = await gitValue(["rev-parse", "--show-toplevel"], seed.cwd, signal);
    const target = deriveNoteTarget({ gitRoot, cwd: seed.cwd }, seed.config.folder);
    if (gitRoot === null) {
      return { target, repo: { name: null, branch: null, commit: null, cwd: seed.cwd } };
    }
    const branch = await gitValue(["rev-parse", "--abbrev-ref", "HEAD"], seed.cwd, signal);
    const commit = await gitValue(["rev-parse", "--short", "HEAD"], seed.cwd, signal);
    return { target, repo: { name: baseName(gitRoot), branch, commit, cwd: seed.cwd } };
  }

  async function gitValue(args: string[], cwd: string, signal: AbortSignal): Promise<string | null> {
    try {
      const result = await pi.exec("git", args, { signal, timeout: GIT_TIMEOUT_MS, cwd });
      if (result.code !== 0) return null;
      const value = (result.stdout ?? "").trim();
      return value.length === 0 ? null : value;
    } catch {
      return null;
    }
  }

  /**
   * Start the background preflight and announce the note once its real
   * destination is known. Never rejects, so the returned promise is safe to
   * hold on the queued job. The started-vs-queued wording is decided
   * synchronously in the handler and only rendered here.
   */
  function startPreflight(
    seed: { id: number; config: NoteConfig; cwd: string; ctx: ExtensionCommandContext },
    status: "started" | "queued",
  ): Promise<NotePreflight> {
    const controller = new AbortController();
    controllers.add(controller);
    return (async () => {
      let preflight: NotePreflight;
      try {
        preflight = await resolvePreflight(seed, controller.signal);
      } catch {
        // Treat any exec failure as "not a Git repo": deterministic fallback.
        preflight = {
          target: deriveNoteTarget({ gitRoot: null, cwd: seed.cwd }, seed.config.folder),
          repo: { name: null, branch: null, commit: null, cwd: seed.cwd },
        };
      } finally {
        controllers.delete(controller);
      }
      if (!controller.signal.aborted) {
        notifyCtx(
          seed.ctx,
          noteMessages.progress(seed.id, status, seed.config.vault, preflight.target.vaultPath),
          "info",
        );
      }
      return preflight;
    })();
  }

  async function synthesize(job: NoteJob, signal: AbortSignal): Promise<AssistantMessage> {
    const prompt = buildNotePrompt(job.evidence, job.idea, job.config);
    return complete(
      job.model,
      { systemPrompt: NOTE_SYSTEM_PROMPT, messages: [userMessage(prompt)] },
      {
        apiKey: job.auth.apiKey,
        headers: job.auth.headers,
        env: job.auth.env,
        reasoningEffort: job.config.reasoningLevel,
        maxTokens: job.config.maxOutputTokens,
        signal,
      },
    );
  }

  async function executeJob(job: NoteJob, signal: AbortSignal): Promise<void> {
    // The preflight both resolves the destination and emits the start notice,
    // so awaiting it here guarantees that notice precedes model completion.
    const { target, repo } = await job.preflight;
    if (signal.aborted) return;

    let response: AssistantMessage;
    try {
      response = await synthesize(job, signal);
    } catch (error) {
      if (signal.aborted || isAbortError(error)) return; // abort stays silent
      throw new NoteModelError(errorMessage(error));
    }
    if (signal.aborted) return;
    if (response.stopReason === "aborted") return;
    if (response.stopReason === "error") {
      throw new NoteModelError(response.errorMessage || "model returned an error");
    }

    // `responseText` and `validateSynthesis` both reject invalid/empty model
    // output; both surface under the `model error` contract.
    const text = responseText(response);
    let synthesis: string;
    try {
      synthesis = validateSynthesis(text, job.config);
    } catch (error) {
      throw new NoteModelError(errorMessage(error));
    }

    const blockInput = {
      timestamp: new Date(),
      idea: job.idea,
      synthesis,
      repo,
      config: job.config,
    };
    const block = renderNoteBlock(blockInput);
    const newNoteContent = renderNewNoteContent(blockInput, target.noteName);

    await runObsidianWrite(
      (cmd, args) => execObsidian(cmd, args, signal),
      job.config,
      target.vaultPath,
      block,
      newNoteContent,
    );
    if (signal.aborted) return;

    const usage = response.usage;
    const tokens = usage ? ` (${usage.input}/${usage.output} tokens)` : "";
    notify(job, noteMessages.saved(job.id, job.config.vault, target.vaultPath, tokens), "info");
  }

  function reportFailure(job: NoteJob, error: unknown): void {
    // Thrown, model, and CLI text may echo the idea or credentials.
    const detail = redactNotification(errorMessage(error));
    if (error instanceof NoteModelError) {
      notify(job, noteMessages.modelError(job.id, detail), "error");
      return;
    }
    if (error instanceof ObsidianWriteError) {
      if (error.kind === "cli-missing") {
        notify(job, noteMessages.cliMissing(), "error");
        return;
      }
      if (error.kind === "not-running" || error.kind === "vault-not-found") {
        notify(job, noteMessages.obsidianUnavailable(job.id, job.config.vault, job.idea), "error");
        return;
      }
    }
    notify(job, noteMessages.failed(job.id, detail, job.idea), "error");
  }

  /** Never throws: a job failure must not poison the queue or escape unhandled. */
  async function runJob(job: NoteJob): Promise<void> {
    const controller = new AbortController();
    controllers.add(controller);
    try {
      await executeJob(job, controller.signal);
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) return; // shutdown: stay silent
      reportFailure(job, error);
    } finally {
      controllers.delete(controller);
    }
  }

  /** Serial drain: appends into one note file never interleave. */
  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    try {
      for (let job = queue.shift(); job !== undefined; job = queue.shift()) {
        await runJob(job);
      }
    } finally {
      running = false;
    }
  }

  pi.registerCommand("note", {
    description: "Capture an idea to the repo's Obsidian note with synthesized context",
    handler: async (args, ctx) => {
      // Redact at intake: no later sink — model prompt, note block, or
      // notification — ever sees the raw idea.
      const idea = redactSecrets((args ?? "").trim()).trim();
      if (idea.length === 0) {
        notifyCtx(ctx, noteMessages.usage(), "error");
        return;
      }

      // Fail fast: everything below must succeed before anything is queued.
      let config: NoteConfig;
      try {
        config = await loadConfig(CONFIG_PATH);
      } catch (error) {
        notifyCtx(ctx, noteMessages.configError(errorMessage(error)), "error");
        return;
      }

      // Registry calls can both throw and report `{ ok: false }`; every path
      // notifies and returns before anything is enqueued.
      let model: Model<any> | undefined;
      try {
        await ctx.modelRegistry.refresh();
        model = ctx.modelRegistry.find(config.provider, config.model);
      } catch (error) {
        notifyCtx(ctx, noteMessages.modelLookupFailed(errorMessage(error)), "error");
        return;
      }
      if (!model) {
        notifyCtx(ctx, noteMessages.modelNotFound(config.provider, config.model), "error");
        return;
      }
      let auth: Awaited<ReturnType<typeof ctx.modelRegistry.getApiKeyAndHeaders>>;
      try {
        auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      } catch (error) {
        notifyCtx(ctx, noteMessages.credentialsUnavailable(errorMessage(error)), "error");
        return;
      }
      if (!auth.ok) {
        notifyCtx(ctx, noteMessages.credentialsUnavailable(auth.error), "error");
        return;
      }

      // Snapshot the transcript synchronously and reduce it immediately, so
      // later conversation activity can never leak into this note.
      const entries = ctx.sessionManager.buildContextEntries();
      const evidence = buildNoteEvidence(entries as unknown[], config);
      const cwd = ctx.cwd;

      jobCounter += 1;
      const id = jobCounter;
      const seed = { id, config, cwd, ctx };

      if (ctx.mode !== "tui") {
        // The process may exit as soon as the handler resolves, so run inline.
        const job: NoteJob = {
          id,
          idea,
          evidence,
          config,
          cwd,
          model,
          auth,
          ctx,
          preflight: startPreflight(seed, "started"),
        };
        await runJob(job);
        return;
      }

      const busy = running || queue.length > 0;
      if (busy && config.concurrencyPolicy === "reject") {
        notifyCtx(ctx, noteMessages.busy(), "warning");
        return;
      }
      if (busy && queue.length >= config.maxQueuedJobs) {
        notifyCtx(ctx, noteMessages.queueFull(config.maxQueuedJobs, idea), "error");
        return;
      }

      // The destination is only known after the argv-only Git probe, so the
      // start notice rides on the background preflight. Status wording is fixed
      // here, synchronously, so started-vs-queued reflects this moment.
      const job: NoteJob = {
        id,
        idea,
        evidence,
        config,
        cwd,
        model,
        auth,
        ctx,
        preflight: startPreflight(seed, busy ? "queued" : "started"),
      };
      queue.push(job);
      // Fire and forget: `drain` swallows every job error.
      void drain();
    },
  });
}

function userMessage(text: string): UserMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

/** Only `text` parts reach the vault; reasoning parts are structurally excluded. */
function responseText(response: AssistantMessage): string {
  const text = response.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  if (text.length === 0) throw new NoteModelError("model returned no text");
  return text;
}

function baseName(path: string): string {
  const parts = path.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] ?? path;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === "AbortError" || /\baborted\b/i.test(error.message))
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
