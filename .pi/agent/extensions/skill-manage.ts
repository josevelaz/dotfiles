/**
 * Reviewed skill_manage tool for Pi.
 *
 * Canonical skill writes go to ~/dotfiles/skills (or ./skills for trusted
 * project scope) and are exposed to agents through .agents/skills symlinks.
 * New skills are written immediately. Updates are staged in a review queue and
 * applied from an interactive diff modal via /skills-review.
 */

import { withFileMutationQueue, type ExtensionAPI, type ExtensionCommandContext, type Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { Type } from "typebox";

const execFileAsync = promisify(execFile);

const VALID_SKILL_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const VALID_CATEGORY_SEGMENT = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const QUEUE_PATH = join(homedir(), ".local", "state", "pi", "skill-manage-queue.json");

function stringEnum<T extends readonly string[]>(values: T, description: string) {
	return Type.Unsafe<T[number]>({ type: "string", enum: values, description });
}

const SkillManageParams = Type.Object({
	action: stringEnum(
		["create", "patch", "edit", "delete", "write_file", "remove_file"] as const,
		"Skill write action. Creates are applied immediately; updates are queued for review.",
	),
	name: Type.String({ description: "Skill name: lowercase letters, numbers, and hyphens only." }),
	scope: Type.Optional(stringEnum(["global", "project"] as const, "Where to save the skill. Defaults to global.")),
	category: Type.Optional(Type.String({ description: "Optional lowercase/hyphen path under the skills root, e.g. devops/aws." })),
	skill_content: Type.Optional(Type.String({ description: "Complete SKILL.md content for create/edit." })),
	content: Type.Optional(Type.String({ description: "Alias for skill_content when action is create/edit." })),
	file_path: Type.Optional(Type.String({ description: "Relative path inside the skill directory for write_file/patch/remove_file." })),
	file_content: Type.Optional(Type.String({ description: "File content for action=write_file." })),
	old_string: Type.Optional(Type.String({ description: "Exact text to replace for action=patch." })),
	new_string: Type.Optional(Type.String({ description: "Replacement text for action=patch." })),
	overwrite: Type.Optional(Type.Boolean({ description: "For create, queue replacement if the skill exists. Defaults to false." })),
});

type SkillManageInput = {
	action: "create" | "patch" | "edit" | "delete" | "write_file" | "remove_file";
	name: string;
	scope?: "global" | "project";
	category?: string;
	skill_content?: string;
	content?: string;
	file_path?: string;
	file_content?: string;
	old_string?: string;
	new_string?: string;
	overwrite?: boolean;
};

type PendingSkillChange = {
	id: string;
	createdAt: string;
	action: SkillManageInput["action"];
	name: string;
	scope: "global" | "project";
	category?: string;
	root: string;
	agentsRoot: string;
	skillDir: string;
	targetPath: string;
	relativeTarget: string;
	previousContent: string | null;
	nextContent: string | null;
	diff: string;
};

type QueueFile = { version: 1; pending: PendingSkillChange[] };
type TextContent = { type: "text"; text: string };

function text(value: string): TextContent[] {
	return [{ type: "text", text: value }];
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

function normalizeContent(content: string): string {
	const trimmed = stripMarkdownFence(content);
	return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
}

function stripMarkdownFence(value: string): string {
	const trimmed = value.trim();
	const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
	return match ? match[1].trimEnd() : trimmed;
}

function ensureSafeSkillName(name: string): void {
	if (!VALID_SKILL_NAME.test(name)) {
		throw new Error("Skill name must be 1-64 chars of lowercase letters, numbers, and hyphens.");
	}
}

function categorySegments(category: string | undefined): string[] {
	if (!category) return [];
	const parts = category.split(/[\\/]+/).filter(Boolean);
	for (const part of parts) {
		if (!VALID_CATEGORY_SEGMENT.test(part)) {
			throw new Error("Category segments must use lowercase letters, numbers, and hyphens only.");
		}
	}
	return parts;
}

function assertSafeRelativePath(filePath: string): string[] {
	if (isAbsolute(filePath)) throw new Error("file_path must be relative.");
	const parts = filePath.split(/[\\/]+/).filter(Boolean);
	if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
		throw new Error("file_path must not contain empty, '.', or '..' segments.");
	}
	return parts;
}

function assertInside(root: string, target: string): void {
	const rel = relative(resolve(root), resolve(target));
	if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
		throw new Error(`Refusing to write outside ${root}`);
	}
}

function rootForScope(scope: "global" | "project", cwd: string): string {
	if (scope === "project") return resolve(cwd, "skills");
	return resolve(homedir(), "dotfiles", "skills");
}

function agentsRootForSkillsRoot(root: string): string {
	return join(dirname(root), ".agents", "skills");
}

function skillDirectory(root: string, category: string | undefined, name: string): string {
	return join(root, ...categorySegments(category), name);
}

function skillPathForAction(dir: string, params: SkillManageInput): string {
	if (params.action === "write_file" || params.action === "remove_file") {
		if (!params.file_path?.trim()) throw new Error("file_path is required for this action.");
		return join(dir, ...assertSafeRelativePath(params.file_path));
	}

	if (params.action === "patch" && params.file_path?.trim()) {
		return join(dir, ...assertSafeRelativePath(params.file_path));
	}

	return join(dir, "SKILL.md");
}

async function ensureSkillSymlink(agentsRoot: string, skillDir: string, name: string): Promise<void> {
	await mkdir(agentsRoot, { recursive: true });
	const linkPath = join(agentsRoot, name);
	const target = relative(agentsRoot, skillDir);

	const currentLink = await readlinkIfSymlink(linkPath);
	if (currentLink === target) return;
	if (currentLink !== null) {
		await rm(linkPath);
	} else if (await exists(linkPath)) {
		throw new Error(`Cannot create skill symlink because ${linkPath} already exists and is not a symlink.`);
	}

	await writeSymlink(target, linkPath);
}

async function readlinkIfSymlink(path: string): Promise<string | null> {
	try {
		const stat = await lstat(path);
		if (!stat.isSymbolicLink()) return null;
		return await readlink(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

async function writeSymlink(target: string, path: string): Promise<void> {
	await symlink(target, path);
}

async function loadQueue(): Promise<QueueFile> {
	try {
		const raw = await readFile(QUEUE_PATH, "utf8");
		const parsed = JSON.parse(raw) as QueueFile;
		return { version: 1, pending: Array.isArray(parsed.pending) ? parsed.pending : [] };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, pending: [] };
		throw error;
	}
}

async function saveQueue(queue: QueueFile): Promise<void> {
	await mkdir(dirname(QUEUE_PATH), { recursive: true });
	await writeFile(QUEUE_PATH, `${JSON.stringify(queue, null, 2)}\n`, "utf8");
}

async function enqueueChange(change: PendingSkillChange): Promise<number> {
	const queue = await loadQueue();
	queue.pending.push(change);
	await saveQueue(queue);
	return queue.pending.length;
}

async function removeFromQueue(id: string): Promise<void> {
	const queue = await loadQueue();
	queue.pending = queue.pending.filter((item) => item.id !== id);
	await saveQueue(queue);
}

async function unifiedDiff(label: string, previousContent: string | null, nextContent: string | null): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pi-skill-diff-"));
	const before = join(dir, "before");
	const after = join(dir, "after");
	await writeFile(before, previousContent ?? "", "utf8");
	await writeFile(after, nextContent ?? "", "utf8");

	try {
		const result = await execFileAsync("diff", ["-u", "--label", `a/${label}`, "--label", `b/${label}`, before, after], {
			maxBuffer: 1024 * 1024 * 2,
		});
		return result.stdout || "(no textual diff)";
	} catch (error) {
		const diffError = error as NodeJS.ErrnoException & { stdout?: string; code?: number };
		if (diffError.code === 1 && typeof diffError.stdout === "string") return diffError.stdout;
		return `Unable to generate diff for ${label}: ${diffError.message}`;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

async function buildPendingChange(params: SkillManageInput, cwd: string): Promise<PendingSkillChange> {
	const scope = params.scope ?? "global";
	ensureSafeSkillName(params.name);
	const root = rootForScope(scope, cwd);
	const agentsRoot = agentsRootForSkillsRoot(root);
	const dir = skillDirectory(root, params.category, params.name);
	const target = skillPathForAction(dir, params);
	assertInside(root, dir);
	assertInside(dir, target);

	let previousContent: string | null = null;
	let nextContent: string | null = null;

	if (await exists(target)) {
		previousContent = await readFile(target, "utf8");
	}

	if (params.action === "delete" || params.action === "remove_file") {
		if (previousContent === null && params.action === "remove_file") throw new Error(`No file exists at ${target}.`);
		nextContent = null;
	} else if (params.action === "patch") {
		if (previousContent === null) throw new Error(`No file exists at ${target}.`);
		if (params.old_string === undefined || params.new_string === undefined) {
			throw new Error("old_string and new_string are required for action=patch.");
		}
		const count = previousContent.split(params.old_string).length - 1;
		if (count !== 1) throw new Error(`old_string must match exactly once in ${target}; found ${count}.`);
		nextContent = previousContent.replace(params.old_string, params.new_string);
	} else if (params.action === "edit") {
		if (previousContent === null) throw new Error(`No SKILL.md exists for ${params.name}; use action=create.`);
		const content = params.skill_content ?? params.content;
		if (!content?.trim()) throw new Error("skill_content is required for action=edit.");
		nextContent = normalizeContent(content);
	} else if (params.action === "write_file") {
		if (!(await exists(join(dir, "SKILL.md")))) throw new Error(`Skill ${params.name} does not exist.`);
		if (params.file_content === undefined) throw new Error("file_content is required for action=write_file.");
		nextContent = normalizeContent(params.file_content);
	} else if (params.action === "create") {
		const content = params.skill_content ?? params.content;
		if (!content?.trim()) throw new Error("skill_content is required for action=create.");
		nextContent = normalizeContent(content);
	}

	const relativeTarget = relative(root, target);
	return {
		id: randomUUID(),
		createdAt: new Date().toISOString(),
		action: params.action,
		name: params.name,
		scope,
		category: params.category,
		root,
		agentsRoot,
		skillDir: dir,
		targetPath: target,
		relativeTarget,
		previousContent,
		nextContent,
		diff: await unifiedDiff(relativeTarget, previousContent, nextContent),
	};
}

async function applyChange(change: PendingSkillChange): Promise<void> {
	await withFileMutationQueue(change.targetPath, async () => {
		if (change.action === "delete") {
			await rm(change.skillDir, { recursive: true, force: true });
			const linkPath = join(change.agentsRoot, change.name);
			if ((await readlinkIfSymlink(linkPath)) !== null) await rm(linkPath, { force: true });
			return;
		}

		if (change.nextContent === null) {
			await rm(change.targetPath, { force: true });
			return;
		}

		await mkdir(dirname(change.targetPath), { recursive: true });
		await writeFile(change.targetPath, change.nextContent, "utf8");
		await ensureSkillSymlink(change.agentsRoot, change.skillDir, change.name);
	});
}

function displayPath(path: string): string {
	const home = homedir();
	return path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}

async function createSkill(params: SkillManageInput, ctx: { cwd: string; isProjectTrusted(): boolean; ui?: { notify(message: string, level: "info" | "warning" | "error"): void } }) {
	const scope = params.scope ?? "global";
	if (scope === "project" && !ctx.isProjectTrusted()) throw new Error("Project scope requires a trusted project.");

	const change = await buildPendingChange(params, ctx.cwd);
	if (await exists(change.targetPath)) {
		if (!params.overwrite) {
			throw new Error(`Skill already exists at ${change.targetPath}. Use action=edit, or create with overwrite=true to queue replacement.`);
		}
		const depth = await enqueueChange({ ...change, action: "edit" });
		ctx.ui?.notify(`Queued skill update: ${params.name}`, "warning");
		return {
			content: text(`Queued replacement for existing skill ${params.name}. Review ${depth} pending change(s) with /skills-review.`),
			details: { queued: true, id: change.id, name: params.name, queueDepth: depth, diff: change.diff },
		};
	}

	await applyChange(change);
	ctx.ui?.notify(`Created skill: ${params.name}`, "info");
	return {
		content: text(`Created skill ${params.name} at ${displayPath(change.targetPath)}. Run /reload to load it in this session.`),
		details: { queued: false, action: "create", name: params.name, path: change.targetPath, reloadRequired: true },
	};
}

async function queueUpdate(params: SkillManageInput, ctx: { cwd: string; isProjectTrusted(): boolean; ui?: { notify(message: string, level: "info" | "warning" | "error"): void } }) {
	const scope = params.scope ?? "global";
	if (scope === "project" && !ctx.isProjectTrusted()) throw new Error("Project scope requires a trusted project.");
	const change = await buildPendingChange(params, ctx.cwd);
	const depth = await enqueueChange(change);
	ctx.ui?.notify(`Queued skill update: ${params.name}`, "warning");
	return {
		content: text(`Queued ${params.action} for skill ${params.name}. Review ${depth} pending change(s) with /skills-review.`),
		details: { queued: true, id: change.id, action: params.action, name: params.name, queueDepth: depth, diff: change.diff },
	};
}

async function listQueue(ctx: ExtensionCommandContext): Promise<void> {
	const queue = await loadQueue();
	if (queue.pending.length === 0) {
		ctx.ui.notify("No pending skill updates.", "info");
		return;
	}

	const lines = queue.pending.map((item, index) => {
		return `${index + 1}. ${item.name} — ${item.action} ${item.relativeTarget} (${item.id.slice(0, 8)})`;
	});
	ctx.ui.notify(`${queue.pending.length} pending skill update(s).`, "info");
	ctx.ui.setWidget("skill-review-queue", ["Pending skill updates:", ...lines, "Run /skills-review to open the diff modal."], {
		placement: "belowEditor",
	});
}

async function reviewQueue(ctx: ExtensionCommandContext): Promise<void> {
	while (true) {
		const queue = await loadQueue();
		if (queue.pending.length === 0) {
			ctx.ui.notify("No pending skill updates.", "info");
			ctx.ui.setWidget("skill-review-queue", undefined);
			return;
		}

		const change = queue.pending[0]!;
		const result = await ctx.ui.custom<"approve" | "reject" | "skip" | "quit" | undefined>(
			(_tui, theme, _keybindings, done) => new SkillDiffModal(theme, change, queue.pending.length, done),
			{ overlay: true, overlayOptions: { width: "90%", maxHeight: "85%", anchor: "center", margin: 1 } },
		);

		if (result === "approve") {
			await applyChange(change);
			await removeFromQueue(change.id);
			ctx.ui.notify(`Applied skill update: ${change.name}`, "info");
			continue;
		}

		if (result === "reject") {
			await removeFromQueue(change.id);
			ctx.ui.notify(`Rejected skill update: ${change.name}`, "info");
			continue;
		}

		if (result === "skip") {
			if (queue.pending.length <= 1) return;
			queue.pending = [...queue.pending.slice(1), change];
			await saveQueue(queue);
			continue;
		}

		return;
	}
}

class SkillDiffModal implements Component {
	private scroll = 0;
	private readonly diffLines: string[];

	constructor(
		private readonly theme: Theme,
		private readonly change: PendingSkillChange,
		private readonly total: number,
		private readonly done: (result: "approve" | "reject" | "skip" | "quit" | undefined) => void,
	) {
		this.diffLines = change.diff.split("\n");
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || data === "q") return this.done("quit");
		if (data === "a") return this.done("approve");
		if (data === "r") return this.done("reject");
		if (data === "s") return this.done("skip");
		if (matchesKey(data, "up") || data === "k") this.scroll = Math.max(0, this.scroll - 1);
		if (matchesKey(data, "down") || data === "j") this.scroll = Math.min(this.maxScroll(), this.scroll + 1);
		if (matchesKey(data, "pageup")) this.scroll = Math.max(0, this.scroll - 10);
		if (matchesKey(data, "pagedown")) this.scroll = Math.min(this.maxScroll(), this.scroll + 10);
	}

	render(width: number): string[] {
		const w = Math.max(60, Math.min(width - 2, 140));
		const inner = w - 2;
		const th = this.theme;
		const row = (content = "") => th.fg("border", "│") + padAnsi(content, inner) + th.fg("border", "│");
		const visibleRows = 28;
		const shown = this.diffLines.slice(this.scroll, this.scroll + visibleRows);
		const lines: string[] = [];

		lines.push(th.fg("border", `╭${"─".repeat(inner)}╮`));
		lines.push(row(` ${th.fg("accent", th.bold(`Skill update: ${this.change.name}`))} ${th.fg("dim", `(${this.total} pending)`)}`));
		lines.push(row(` ${th.fg("muted", "Action:")} ${this.change.action}   ${th.fg("muted", "Target:")} ${displayPath(this.change.targetPath)}`));
		lines.push(row(` ${th.fg("dim", "a approve • r reject • s skip • q/esc quit • ↑↓/j/k scroll")}`));
		lines.push(row(th.fg("borderMuted", "─".repeat(Math.max(0, inner - 1)))));

		for (const line of shown) lines.push(row(` ${this.styleDiffLine(line)}`));
		for (let i = shown.length; i < visibleRows; i++) lines.push(row());

		const position = this.diffLines.length === 0
			? "0/0"
			: `${Math.min(this.scroll + visibleRows, this.diffLines.length)}/${this.diffLines.length}`;
		lines.push(row(th.fg("dim", ` Diff lines ${position}`)));
		lines.push(th.fg("border", `╰${"─".repeat(inner)}╯`));
		return lines.map((line) => truncateToWidth(line, width, ""));
	}

	invalidate(): void {}

	private maxScroll(): number {
		return Math.max(0, this.diffLines.length - 1);
	}

	private styleDiffLine(line: string): string {
		if (line.startsWith("+")) return this.theme.fg("toolDiffAdded", line);
		if (line.startsWith("-")) return this.theme.fg("toolDiffRemoved", line);
		if (line.startsWith("@@")) return this.theme.fg("accent", line);
		if (line.startsWith("diff") || line.startsWith("---") || line.startsWith("+++")) return this.theme.fg("muted", line);
		return this.theme.fg("toolDiffContext", line);
	}
}

function padAnsi(value: string, width: number): string {
	const truncated = truncateToWidth(value, width, "");
	return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

export default function skillManage(pi: ExtensionAPI) {
	pi.registerTool({
		name: "skill_manage",
		label: "Skill Manage",
		description: "Create, edit, patch, delete, and add files to Pi Agent Skills with reviewed update flow.",
		promptSnippet: "Create skills in ~/dotfiles/skills and queue skill updates for user review.",
		promptGuidelines: [
			"Use skill_manage when the user asks to create, learn, edit, patch, or update a reusable Pi Agent Skill.",
			"skill_manage creates new skills immediately, but queues edits, patches, deletes, and supplemental file changes for user review.",
			"Do not use skill_manage for ordinary project files; use write or edit instead.",
		],
		parameters: SkillManageParams,
		async execute(_toolCallId, params: SkillManageInput, _signal, _onUpdate, ctx) {
			if (params.action === "create") return createSkill(params, ctx);
			return queueUpdate(params, ctx);
		},
	});

	pi.registerCommand("skills-review", {
		description: "Review queued skill updates in a diff modal",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (trimmed === "list") return listQueue(ctx);
			await reviewQueue(ctx);
		},
	});

	pi.registerCommand("skills-queue", {
		description: "List queued skill updates",
		handler: async (_args, ctx) => listQueue(ctx),
	});
}
