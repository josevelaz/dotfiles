/**
 * skill_manage — core action executors for Pi Agent Skills.
 *
 * Canonical skill writes go to ~/dotfiles/skills (global) or ./skills (trusted
 * project scope) and are exposed to agents through relative .agents/skills
 * symlinks.
 *
 * This module implements the six mutating actions (create, edit, patch, delete,
 * write_file, remove_file) as explicit-root executors so they can be driven
 * directly by the tool, replayed later from a staged approval queue, and
 * exercised by tests in temporary directories.
 *
 * Security posture: every executor validates its own inputs from scratch and
 * never trusts a caller-supplied absolute path. `scanSkillContent` is a review
 * trigger that surfaces risky shell patterns to the user — it is NOT a sandbox
 * and must never be described as one.
 */

import {
	DynamicBorder,
	withFileMutationQueue,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	matchesKey,
	SelectList,
	Text,
	truncateToWidth,
	visibleWidth,
	type Component,
	type SelectItem,
} from "@earendil-works/pi-tui";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	access,
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readlink,
	realpath,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { Type } from "typebox";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Bounds and vocabulary
// ---------------------------------------------------------------------------

export const VALID_SKILL_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const VALID_CATEGORY_SEGMENT = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export const MAX_SKILL_NAME_LENGTH = 64;
export const MAX_CATEGORY_DEPTH = 3;
export const MAX_CONTENT_BYTES = 512 * 1024;
export const MAX_RELATIVE_PATH_LENGTH = 200;
export const MAX_RELATIVE_PATH_DEPTH = 4;

/** Supporting directories an agent may write into beside SKILL.md. */
export const ALLOWED_SUPPORT_DIRS = ["references", "templates", "scripts", "assets"] as const;

export const SKILL_FILE_NAME = "SKILL.md";

export type SkillScope = "global" | "project";
export type SkillAction = "create" | "edit" | "patch" | "delete" | "write_file" | "remove_file";

export const SKILL_ACTIONS: readonly SkillAction[] = [
	"create",
	"edit",
	"patch",
	"delete",
	"write_file",
	"remove_file",
] as const;

// ---------------------------------------------------------------------------
// Tool parameter schema
// ---------------------------------------------------------------------------

function stringEnum<T extends readonly string[]>(values: T, description: string) {
	return Type.Unsafe<T[number]>({ type: "string", enum: values, description });
}

export const SkillManageParams = Type.Object({
	action: stringEnum(SKILL_ACTIONS as readonly string[] as ["create"], "Skill write action."),
	name: Type.String({ description: "Skill name: lowercase letters, numbers, and hyphens only (max 64 chars)." }),
	scope: Type.Optional(stringEnum(["global", "project"] as const, "Where to save the skill. Defaults to global.")),
	category: Type.Optional(
		Type.String({ description: "Optional lowercase/hyphen path under the skills root, max 3 segments, e.g. devops/aws." }),
	),
	skill_content: Type.Optional(Type.String({ description: "Complete SKILL.md content for create/edit." })),
	content: Type.Optional(Type.String({ description: "Alias for skill_content when action is create/edit." })),
	file_path: Type.Optional(
		Type.String({ description: "Relative path inside the skill directory for write_file/patch/remove_file." }),
	),
	file_content: Type.Optional(Type.String({ description: "File content for action=write_file." })),
	old_string: Type.Optional(Type.String({ description: "Exact text to replace for action=patch." })),
	new_string: Type.Optional(Type.String({ description: "Replacement text for action=patch." })),
	overwrite: Type.Optional(Type.Boolean({ description: "For create, allow replacing an existing skill. Defaults to false." })),
});

export type SkillManageInput = {
	action: SkillAction;
	name: string;
	scope?: SkillScope;
	category?: string;
	skill_content?: string;
	content?: string;
	file_path?: string;
	file_content?: string;
	old_string?: string;
	new_string?: string;
	overwrite?: boolean;
};

/** Fully validated action payload; every field is already bounds-checked. */
export type ValidatedSkillAction = {
	action: SkillAction;
	name: string;
	scope: SkillScope;
	category?: string;
	categorySegments: string[];
	relativeSegments: string[];
	skillDir: string;
	targetPath: string;
	relativeTarget: string;
	content?: string;
	oldString?: string;
	newString?: string;
	overwrite: boolean;
};

export type SkillRoots = {
	scope: SkillScope;
	/** Directory holding skill directories, e.g. ~/dotfiles/skills. */
	skillsRoot: string;
	/** Directory holding agent-visible symlinks, e.g. ~/dotfiles/.agents/skills. */
	agentsRoot: string;
	/** Path of the installed-skill lock file, e.g. ~/dotfiles/.agents/.skill-lock.json. */
	lockPath: string;
};

export type SkillActionResult = {
	action: SkillAction;
	name: string;
	scope: SkillScope;
	skillDir: string;
	targetPath: string;
	relativeTarget: string;
	previousContent: string | null;
	nextContent: string | null;
	securityFlags: string[];
	message: string;
};

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

export async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

export function stripMarkdownFence(value: string): string {
	const trimmed = value.trim();
	const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
	return match ? match[1]!.trimEnd() : trimmed;
}

export function normalizeContent(content: string): string {
	const trimmed = stripMarkdownFence(content);
	return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
}

export function displayPath(path: string, home: string = homedir()): string {
	return path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function ensureSafeSkillName(name: string): string {
	const value = typeof name === "string" ? name.trim() : "";
	if (value.length === 0) throw new Error("Skill name is required.");
	if (value.length > MAX_SKILL_NAME_LENGTH) {
		throw new Error(`Skill name must be at most ${MAX_SKILL_NAME_LENGTH} characters; got ${value.length}.`);
	}
	if (!VALID_SKILL_NAME.test(value)) {
		throw new Error("Skill name must be 1-64 chars of lowercase letters, numbers, and hyphens (no leading/trailing hyphen).");
	}
	return value;
}

export function categorySegments(category: string | undefined): string[] {
	if (!category || category.trim() === "") return [];
	const parts = category.split(/[\\/]+/).filter(Boolean);
	if (parts.length > MAX_CATEGORY_DEPTH) {
		throw new Error(`Category may have at most ${MAX_CATEGORY_DEPTH} segments; got ${parts.length}.`);
	}
	for (const part of parts) {
		if (part === "." || part === "..") throw new Error("Category segments must not be '.' or '..'.");
		if (!VALID_CATEGORY_SEGMENT.test(part)) {
			throw new Error("Category segments must use lowercase letters, numbers, and hyphens only.");
		}
		if (part.length > MAX_SKILL_NAME_LENGTH) {
			throw new Error(`Category segment '${part}' exceeds ${MAX_SKILL_NAME_LENGTH} characters.`);
		}
	}
	return parts;
}

export function assertSafeRelativePath(filePath: string): string[] {
	if (typeof filePath !== "string" || filePath.trim() === "") throw new Error("file_path is required for this action.");
	const value = filePath.trim();
	if (isAbsolute(value) || value.startsWith("/") || value.startsWith("\\")) throw new Error("file_path must be relative.");
	if (/^[a-zA-Z]:[\\/]/.test(value)) throw new Error("file_path must be relative.");
	if (value.length > MAX_RELATIVE_PATH_LENGTH) {
		throw new Error(`file_path must be at most ${MAX_RELATIVE_PATH_LENGTH} characters; got ${value.length}.`);
	}
	if (value.includes("\0")) throw new Error("file_path must not contain NUL bytes.");

	const parts = value.split(/[\\/]+/).filter((part) => part !== "");
	if (parts.length === 0) throw new Error("file_path must not be empty.");
	if (parts.length > MAX_RELATIVE_PATH_DEPTH) {
		throw new Error(`file_path may be at most ${MAX_RELATIVE_PATH_DEPTH} segments deep; got ${parts.length}.`);
	}
	for (const part of parts) {
		if (part === "." || part === "..") {
			throw new Error("file_path must not contain empty, '.', or '..' segments.");
		}
	}
	return parts;
}

/**
 * Supporting files must live directly beside SKILL.md or under one of the
 * allowed supporting directories.
 */
export function assertAllowedSupportPath(parts: string[]): void {
	if (parts.length === 1) return;
	const top = parts[0]!;
	if (!(ALLOWED_SUPPORT_DIRS as readonly string[]).includes(top)) {
		throw new Error(
			`Supporting files must be at the skill root or under one of: ${ALLOWED_SUPPORT_DIRS.join(", ")}. Got '${top}/'.`,
		);
	}
}

/**
 * Deliberate divergence from upstream Hermes, which only checks the top-level
 * path: write_file/remove_file must never touch SKILL.md at ANY nesting level,
 * and the comparison is case-insensitive because the macOS default filesystem
 * is case-insensitive (`skill.md` and `SKILL.md` are the same file there).
 */
export function assertNotSkillFile(parts: string[]): void {
	for (const part of parts) {
		if (part.toLowerCase() === SKILL_FILE_NAME.toLowerCase()) {
			throw new Error("Refusing to touch SKILL.md through write_file/remove_file; use action=create, edit, or patch.");
		}
	}
}

export function assertContentWithinBounds(content: string, label: string): string {
	const bytes = Buffer.byteLength(content, "utf8");
	if (bytes > MAX_CONTENT_BYTES) {
		throw new Error(`${label} exceeds the ${Math.floor(MAX_CONTENT_BYTES / 1024)} KiB limit (${bytes} bytes).`);
	}
	return content;
}

export function assertInside(root: string, target: string): void {
	const rel = relative(resolve(root), resolve(target));
	if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith("../") || isAbsolute(rel)) {
		throw new Error(`Refusing to operate outside ${root} (resolved target: ${target}).`);
	}
}

// ---------------------------------------------------------------------------
// Roots and path computation
// ---------------------------------------------------------------------------

export function rootForScope(scope: SkillScope, cwd: string, home: string = homedir()): string {
	if (scope === "project") return resolve(cwd, "skills");
	return resolve(home, "dotfiles", "skills");
}

export function agentsRootForSkillsRoot(skillsRoot: string): string {
	return join(dirname(skillsRoot), ".agents", "skills");
}

export function lockPathForSkillsRoot(skillsRoot: string): string {
	return join(dirname(skillsRoot), ".agents", ".skill-lock.json");
}

export function resolveSkillRoots(scope: SkillScope, cwd: string, home: string = homedir()): SkillRoots {
	const skillsRoot = rootForScope(scope, cwd, home);
	return {
		scope,
		skillsRoot,
		agentsRoot: agentsRootForSkillsRoot(skillsRoot),
		lockPath: lockPathForSkillsRoot(skillsRoot),
	};
}

/** Build explicit roots for an arbitrary base directory (used by tests). */
export function skillRootsForBase(base: string, scope: SkillScope = "global"): SkillRoots {
	const skillsRoot = resolve(base, "skills");
	return {
		scope,
		skillsRoot,
		agentsRoot: agentsRootForSkillsRoot(skillsRoot),
		lockPath: lockPathForSkillsRoot(skillsRoot),
	};
}

export function skillDirectory(skillsRoot: string, segments: string[], name: string): string {
	return join(skillsRoot, ...segments, name);
}

/**
 * Validate a raw tool payload into a fully resolved, bounds-checked action.
 * Called both for direct execution and (later) for untrusted replay.
 */
export function validateSkillAction(params: SkillManageInput, roots: SkillRoots): ValidatedSkillAction {
	if (!SKILL_ACTIONS.includes(params.action)) {
		throw new Error(`Unknown action '${String(params.action)}'. Expected one of: ${SKILL_ACTIONS.join(", ")}.`);
	}

	const name = ensureSafeSkillName(params.name);
	const segments = categorySegments(params.category);
	const skillDir = skillDirectory(roots.skillsRoot, segments, name);
	assertInside(roots.skillsRoot, skillDir);

	let relativeSegments: string[];
	if (params.action === "write_file" || params.action === "remove_file") {
		relativeSegments = assertSafeRelativePath(params.file_path ?? "");
		assertNotSkillFile(relativeSegments);
		assertAllowedSupportPath(relativeSegments);
	} else if (params.action === "patch" && params.file_path?.trim()) {
		relativeSegments = assertSafeRelativePath(params.file_path);
		if (relativeSegments.length > 1 || relativeSegments[0]!.toLowerCase() !== SKILL_FILE_NAME.toLowerCase()) {
			assertAllowedSupportPath(relativeSegments);
		}
	} else if (params.action === "delete") {
		relativeSegments = [];
	} else {
		relativeSegments = [SKILL_FILE_NAME];
	}

	const targetPath = relativeSegments.length === 0 ? skillDir : join(skillDir, ...relativeSegments);
	assertInside(roots.skillsRoot, targetPath);
	if (relativeSegments.length > 0) assertInside(skillDir, targetPath);

	const validated: ValidatedSkillAction = {
		action: params.action,
		name,
		scope: roots.scope,
		category: segments.length > 0 ? segments.join("/") : undefined,
		categorySegments: segments,
		relativeSegments,
		skillDir,
		targetPath,
		relativeTarget: relative(roots.skillsRoot, targetPath),
		overwrite: params.overwrite === true,
	};

	if (params.action === "create" || params.action === "edit") {
		const raw = params.skill_content ?? params.content;
		if (!raw?.trim()) throw new Error(`skill_content is required for action=${params.action}.`);
		validated.content = assertContentWithinBounds(normalizeContent(raw), "SKILL.md content");
	} else if (params.action === "write_file") {
		if (params.file_content === undefined) throw new Error("file_content is required for action=write_file.");
		validated.content = assertContentWithinBounds(normalizeContent(params.file_content), "file_content");
	} else if (params.action === "patch") {
		if (params.old_string === undefined || params.new_string === undefined) {
			throw new Error("old_string and new_string are required for action=patch.");
		}
		if (params.old_string === "") throw new Error("old_string must not be empty for action=patch.");
		if (params.old_string === params.new_string) throw new Error("old_string and new_string are identical; nothing to patch.");
		assertContentWithinBounds(params.new_string, "new_string");
		validated.oldString = params.old_string;
		validated.newString = params.new_string;
	}

	return validated;
}

// ---------------------------------------------------------------------------
// Symlink-escape protection
// ---------------------------------------------------------------------------

/**
 * Resolve `path` through realpath as far as it exists, then re-append the
 * not-yet-created tail. This defeats a symlinked intermediate component that
 * would otherwise redirect a write outside the skills root.
 */
export async function resolveExistingPrefix(path: string): Promise<string> {
	const absolute = resolve(path);
	const tail: string[] = [];
	let current = absolute;

	for (;;) {
		try {
			const real = await realpath(current);
			return tail.length === 0 ? real : join(real, ...tail);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
			const parent = dirname(current);
			if (parent === current) return absolute;
			tail.unshift(basename(current));
			current = parent;
		}
	}
}

/** Re-run containment on realpath-resolved paths before any mutation. */
export async function assertResolvedInside(root: string, target: string): Promise<void> {
	const resolvedRoot = await resolveExistingPrefix(root);
	const resolvedTarget = await resolveExistingPrefix(target);
	assertInside(resolvedRoot, resolvedTarget);
}

async function assertSafeMutationTarget(roots: SkillRoots, action: ValidatedSkillAction): Promise<void> {
	await assertResolvedInside(roots.skillsRoot, action.skillDir);
	if (action.targetPath !== action.skillDir) {
		await assertResolvedInside(roots.skillsRoot, action.targetPath);
		await assertResolvedInside(action.skillDir, action.targetPath);
	}

	// A symlinked target file itself must never be followed on write/remove.
	const link = await readlinkIfSymlink(action.targetPath);
	if (link !== null && action.action !== "delete") {
		throw new Error(`Refusing to operate on symlink ${action.targetPath}.`);
	}
}

export async function readlinkIfSymlink(path: string): Promise<string | null> {
	try {
		const stat = await lstat(path);
		if (!stat.isSymbolicLink()) return null;
		return await readlink(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

/**
 * Agent-visible symlinks are ALWAYS relative (e.g. ../../skills/<name>);
 * absolute targets break sync-skills' expected_custom_target comparison.
 */
export function symlinkTargetFor(agentsRoot: string, skillDir: string): string {
	return relative(agentsRoot, skillDir);
}

export async function ensureSkillSymlink(agentsRoot: string, skillDir: string, name: string): Promise<string> {
	await mkdir(agentsRoot, { recursive: true });
	const linkPath = join(agentsRoot, name);
	const target = symlinkTargetFor(agentsRoot, skillDir);
	if (isAbsolute(target)) throw new Error("Refusing to create an absolute skill symlink target.");

	const currentLink = await readlinkIfSymlink(linkPath);
	if (currentLink === target) return linkPath;
	if (currentLink !== null) {
		await rm(linkPath, { force: true });
	} else if (await pathExists(linkPath)) {
		throw new Error(`Cannot create skill symlink because ${linkPath} already exists and is not a symlink.`);
	}

	await symlink(target, linkPath);
	return linkPath;
}

export async function removeSkillSymlink(agentsRoot: string, name: string): Promise<void> {
	const linkPath = join(agentsRoot, name);
	if ((await readlinkIfSymlink(linkPath)) !== null) await rm(linkPath, { force: true });
}

// ---------------------------------------------------------------------------
// Lock file (installed / third-party skills)
// ---------------------------------------------------------------------------

/** Names present in .agents/.skill-lock.json. A missing or invalid file yields an empty set. */
export async function readLockedSkillNames(lockPath: string): Promise<Set<string>> {
	try {
		const raw = await readFile(lockPath, "utf8");
		const parsed = JSON.parse(raw) as { skills?: Record<string, unknown> };
		const skills = parsed?.skills;
		if (!skills || typeof skills !== "object" || Array.isArray(skills)) return new Set();
		return new Set(Object.keys(skills));
	} catch {
		return new Set();
	}
}

const LOCK_GUARDED_ACTIONS: readonly SkillAction[] = ["create", "edit", "delete"];

export async function assertNotLockedSkill(roots: SkillRoots, action: ValidatedSkillAction): Promise<void> {
	if (!LOCK_GUARDED_ACTIONS.includes(action.action)) return;
	const locked = await readLockedSkillNames(roots.lockPath);
	if (locked.has(action.name)) {
		throw new Error(
			`Skill '${action.name}' is installed from an external source and is locked in ${roots.lockPath}. ` +
				`Refusing action=${action.action}. Fork it under a different name instead.`,
		);
	}
}

// ---------------------------------------------------------------------------
// Security scan
// ---------------------------------------------------------------------------

type ScanRule = { flag: string; test: (line: string) => boolean };

const SHELL = String.raw`(?:ba|z|k|a|d|fi)?sh`;
const REMOTE_FETCH = String.raw`(?:curl|wget|fetch|iwr|Invoke-WebRequest)`;

const SECRET_PATH =
	/(?:~|\$HOME|\$\{HOME\}|\/(?:home|Users)\/[^\s/]+)\/\.(?:ssh|aws|gnupg|kube|docker|netrc|config\/gh)\b|\bid_(?:rsa|dsa|ecdsa|ed25519)\b|\/\.aws\/credentials\b|(?:^|[\s"'`=(/])\.env(?![\w.-])/;
const SECRET_CONSUMER =
	/\b(?:cat|bat|less|more|head|tail|source|cp|mv|scp|rsync|sftp|tar|zip|gzip|base64|xxd|od|strings|openssl|grep|awk|sed|curl|wget|python3?|node|ruby|perl)\b|^\s*\.\s|\bexport\b/;

const SCAN_RULES: ScanRule[] = [
	{
		flag: "Pipes remote content directly into a shell (curl/wget | sh)",
		test: (line) => new RegExp(String.raw`${REMOTE_FETCH}\b[^\n|]*\|\s*(?:sudo\s+)?(?:${SHELL}|python3?|perl|ruby|node)\b`, "i").test(line),
	},
	{
		flag: "Executes a downloaded file (fetch then run)",
		test: (line) =>
			new RegExp(String.raw`${REMOTE_FETCH}\b[^\n]*-[oO]\s*\S+[^\n]*(?:&&|;)\s*(?:sudo\s+)?(?:\./|${SHELL}\s)`, "i").test(line) ||
			/\bbash\s+<\(\s*(?:curl|wget)\b/i.test(line),
	},
	{
		flag: "Requests privilege escalation with sudo",
		test: (line) => /(?:^|[\s;&|(`])sudo(?:\s|$)/.test(line) || /(?:^|[\s;&|(`])doas\s/.test(line),
	},
	{
		flag: "Recursive force delete targeting a sensitive root (/, ~, or $HOME)",
		test: (line) => {
			if (!/\brm\b/.test(line)) return false;
			if (!/\brm\s+(?:-\w+\s+)*-\w*r\w*/i.test(line) && !/\brm\s+(?:-\w+\s+)*-\w*f\w*/i.test(line)) return false;
			return /\brm\s+(?:-\S+\s+)*(?:\/|~|\$HOME|\$\{HOME\}|\$\w+)\s*(?:$|[;&|])/.test(line) ||
				/\brm\s+(?:-\S+\s+)*(?:~|\$HOME|\$\{HOME\})\//.test(line) ||
				/\brm\s+(?:-\S+\s+)*\/(?:\*|\s|$)/.test(line) ||
				/\brm\s+(?:-\S+\s+)*\/(?:etc|usr|var|bin|sbin|lib|System|Library|Applications)\b/.test(line);
		},
	},
	{
		flag: "Decodes an encoded payload and executes it",
		test: (line) =>
			new RegExp(String.raw`\b(?:base64|openssl\s+enc|xxd|uudecode)\b[^\n|]*\|\s*(?:sudo\s+)?(?:${SHELL}|python3?|perl|ruby|node)\b`, "i").test(line) ||
			/\b(?:atob|fromCharCode)\s*\([^\n]*\)\s*\)?\s*(?:\||;)?\s*(?:eval|exec)/i.test(line) ||
			/\b(?:python3?|node|ruby|perl)\b[^\n]*-[ce]\s*['"][^\n]*(?:b64decode|atob|decode\(['"]base64)/i.test(line),
	},
	{
		flag: "Evaluates dynamically constructed code (eval/exec)",
		test: (line) =>
			/\beval\s+["'`]?\$\(/.test(line) ||
			/\beval\s+["'`]?`/.test(line) ||
			/\beval\s*\(\s*(?:atob|Buffer\.from|require)/.test(line) ||
			/\bexec\s*\(\s*(?:base64|__import__)/.test(line) ||
			/\|\s*(?:sudo\s+)?(?:source|\.)\s+\/dev\/stdin/.test(line),
	},
	{
		flag: "Reads credentials or secret files (~/.ssh, ~/.aws, .env)",
		test: (line) => SECRET_PATH.test(line) && SECRET_CONSUMER.test(line),
	},
	{
		flag: "Uploads or exfiltrates local data to a remote endpoint",
		test: (line) =>
			/\bcurl\b[^\n]*(?:--data(?:-binary|-raw|-urlencode)?|-d)\s*["']?@/i.test(line) ||
			/\bcurl\b[^\n]*(?:-F|--form)\s*["']?[^\n"']*=@/i.test(line) ||
			/\bcurl\b[^\n]*(?:-T\s|--upload-file)/i.test(line) ||
			/\bwget\b[^\n]*--post-file/i.test(line) ||
			/\b(?:nc|ncat|netcat)\b[^\n]*\s(?:-\w+\s+)*\S+\s+\d{2,5}\b/i.test(line) ||
			/\b(?:scp|rsync)\b[^\n]*\s\S+@\S+:/i.test(line),
	},
];

/**
 * Scan new or resulting skill content for risky shell patterns.
 *
 * Returns human-readable flags. This is a review trigger for the user, NOT a
 * sandbox or a guarantee of safety. Previous content is never scanned.
 */
export function scanSkillContent(content: string, filePath: string): string[] {
	if (typeof content !== "string" || content.length === 0) return [];
	const flags = new Map<string, number>();
	const lines = content.split(/\r?\n/);

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index]!;
		if (line.trim() === "") continue;
		for (const rule of SCAN_RULES) {
			if (flags.has(rule.flag)) continue;
			try {
				if (rule.test(line)) flags.set(rule.flag, index + 1);
			} catch {
				// A malformed line must never break the scan.
			}
		}
	}

	const label = filePath && filePath.trim() !== "" ? filePath : "content";
	return [...flags.entries()]
		.sort((a, b) => a[1] - b[1])
		.map(([flag, line]) => `${label}:${line}: ${flag}`);
}

// ---------------------------------------------------------------------------
// Atomic filesystem writes
// ---------------------------------------------------------------------------

export async function atomicWriteFile(target: string, content: string): Promise<void> {
	const dir = dirname(target);
	await mkdir(dir, { recursive: true });
	const temp = join(dir, `.skill-manage-${randomUUID()}.tmp`);
	try {
		await writeFile(temp, content, { encoding: "utf8", mode: 0o644 });
		await rename(temp, target);
	} catch (error) {
		await rm(temp, { force: true }).catch(() => {});
		throw error;
	}
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/** `diff -u` exits 1 when differences exist; that is success, not failure. */
export async function unifiedDiff(label: string, previousContent: string | null, nextContent: string | null): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pi-skill-diff-"));
	const before = join(dir, "before");
	const after = join(dir, "after");
	try {
		await writeFile(before, previousContent ?? "", "utf8");
		await writeFile(after, nextContent ?? "", "utf8");
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

// ---------------------------------------------------------------------------
// Action executors (explicit roots — directly callable and replayable)
// ---------------------------------------------------------------------------

async function readIfExists(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "EISDIR") return null;
		throw error;
	}
}

async function prepare(roots: SkillRoots, params: SkillManageInput): Promise<ValidatedSkillAction> {
	const action = validateSkillAction(params, roots);
	await assertNotLockedSkill(roots, action);
	await assertSafeMutationTarget(roots, action);
	return action;
}

function baseResult(action: ValidatedSkillAction, extra: Partial<SkillActionResult>): SkillActionResult {
	return {
		action: action.action,
		name: action.name,
		scope: action.scope,
		skillDir: action.skillDir,
		targetPath: action.targetPath,
		relativeTarget: action.relativeTarget,
		previousContent: null,
		nextContent: null,
		securityFlags: [],
		message: "",
		...extra,
	};
}

export async function executeCreate(roots: SkillRoots, params: SkillManageInput): Promise<SkillActionResult> {
	const action = await prepare(roots, { ...params, action: "create" });
	const content = action.content!;
	const previous = await readIfExists(action.targetPath);

	if (previous !== null && !action.overwrite) {
		throw new Error(
			`Skill '${action.name}' already exists at ${action.targetPath}. Use action=edit, or create with overwrite=true.`,
		);
	}

	const securityFlags = scanSkillContent(content, action.relativeTarget);

	await withFileMutationQueue(action.targetPath, async () => {
		await mkdir(action.skillDir, { recursive: true });
		await atomicWriteFile(action.targetPath, content);
		await ensureSkillSymlink(roots.agentsRoot, action.skillDir, action.name);
	});

	return baseResult(action, {
		previousContent: previous,
		nextContent: content,
		securityFlags,
		message: `${previous === null ? "Created" : "Replaced"} skill ${action.name} at ${displayPath(action.targetPath)}.`,
	});
}

export async function executeEdit(roots: SkillRoots, params: SkillManageInput): Promise<SkillActionResult> {
	const action = await prepare(roots, { ...params, action: "edit" });
	const content = action.content!;
	const previous = await readIfExists(action.targetPath);
	if (previous === null) throw new Error(`No SKILL.md exists for '${action.name}'; use action=create.`);

	const securityFlags = scanSkillContent(content, action.relativeTarget);

	await withFileMutationQueue(action.targetPath, async () => {
		await atomicWriteFile(action.targetPath, content);
		await ensureSkillSymlink(roots.agentsRoot, action.skillDir, action.name);
	});

	return baseResult(action, {
		previousContent: previous,
		nextContent: content,
		securityFlags,
		message: `Updated SKILL.md for ${action.name} at ${displayPath(action.targetPath)}.`,
	});
}

export async function executePatch(roots: SkillRoots, params: SkillManageInput): Promise<SkillActionResult> {
	const action = await prepare(roots, { ...params, action: "patch" });
	const previous = await readIfExists(action.targetPath);
	if (previous === null) throw new Error(`No file exists at ${action.targetPath}.`);

	const occurrences = previous.split(action.oldString!).length - 1;
	if (occurrences !== 1) {
		throw new Error(`old_string must match exactly once in ${action.relativeTarget}; found ${occurrences}.`);
	}

	const next = assertContentWithinBounds(previous.replace(action.oldString!, action.newString!), "patched content");
	const securityFlags = scanSkillContent(next, action.relativeTarget);

	await withFileMutationQueue(action.targetPath, async () => {
		await atomicWriteFile(action.targetPath, next);
	});

	return baseResult(action, {
		previousContent: previous,
		nextContent: next,
		securityFlags,
		message: `Patched ${action.relativeTarget} for ${action.name}.`,
	});
}

export async function executeDelete(roots: SkillRoots, params: SkillManageInput): Promise<SkillActionResult> {
	const action = await prepare(roots, { ...params, action: "delete" });
	if (!(await pathExists(action.skillDir))) throw new Error(`Skill '${action.name}' does not exist at ${action.skillDir}.`);
	const previous = await readIfExists(join(action.skillDir, SKILL_FILE_NAME));

	await withFileMutationQueue(action.skillDir, async () => {
		await rm(action.skillDir, { recursive: true, force: true });
		await removeSkillSymlink(roots.agentsRoot, action.name);
	});

	return baseResult(action, {
		previousContent: previous,
		nextContent: null,
		message: `Deleted skill ${action.name} from ${displayPath(action.skillDir)}.`,
	});
}

export async function executeWriteFile(roots: SkillRoots, params: SkillManageInput): Promise<SkillActionResult> {
	const action = await prepare(roots, { ...params, action: "write_file" });
	if (!(await pathExists(join(action.skillDir, SKILL_FILE_NAME)))) {
		throw new Error(`Skill '${action.name}' does not exist; create it before adding supporting files.`);
	}

	const content = action.content!;
	const previous = await readIfExists(action.targetPath);
	const securityFlags = scanSkillContent(content, action.relativeTarget);

	await withFileMutationQueue(action.targetPath, async () => {
		await atomicWriteFile(action.targetPath, content);
	});

	return baseResult(action, {
		previousContent: previous,
		nextContent: content,
		securityFlags,
		message: `Wrote ${action.relativeTarget} for ${action.name}.`,
	});
}

export async function executeRemoveFile(roots: SkillRoots, params: SkillManageInput): Promise<SkillActionResult> {
	const action = await prepare(roots, { ...params, action: "remove_file" });
	const previous = await readIfExists(action.targetPath);
	if (previous === null && !(await pathExists(action.targetPath))) {
		throw new Error(`No file exists at ${action.targetPath}.`);
	}

	await withFileMutationQueue(action.targetPath, async () => {
		await rm(action.targetPath, { force: true });
	});

	return baseResult(action, {
		previousContent: previous,
		nextContent: null,
		message: `Removed ${action.relativeTarget} from ${action.name}.`,
	});
}

export const SKILL_ACTION_EXECUTORS: Record<
	SkillAction,
	(roots: SkillRoots, params: SkillManageInput) => Promise<SkillActionResult>
> = {
	create: executeCreate,
	edit: executeEdit,
	patch: executePatch,
	delete: executeDelete,
	write_file: executeWriteFile,
	remove_file: executeRemoveFile,
};

export async function executeSkillAction(roots: SkillRoots, params: SkillManageInput): Promise<SkillActionResult> {
	const executor = SKILL_ACTION_EXECUTORS[params.action];
	if (!executor) throw new Error(`Unknown action '${String(params.action)}'.`);
	return executor(roots, params);
}

export function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

// ---------------------------------------------------------------------------
// Dry-run preview (shared by staging and by the review modal)
// ---------------------------------------------------------------------------

export type SkillActionPreview = {
	action: ValidatedSkillAction;
	previousContent: string | null;
	nextContent: string | null;
	securityFlags: string[];
	gist: string;
};

function firstFrontmatterDescription(content: string): string | null {
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return null;
	const line = match[1]!.split(/\r?\n/).find((candidate) => /^description\s*:/i.test(candidate));
	if (!line) return null;
	const value = line.replace(/^description\s*:/i, "").trim().replace(/^["']|["']$/g, "");
	return value === "" ? null : value;
}

function truncateGist(value: string, max = 120): string {
	const flat = value.replace(/\s+/g, " ").trim();
	return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** One-line human summary stored on the queue record, e.g. "create skill 'foo': …". */
export function buildGist(action: ValidatedSkillAction, previousContent: string | null, nextContent: string | null): string {
	const subject = `${action.action} skill '${action.name}'`;
	let detail: string | null = null;

	if ((action.action === "create" || action.action === "edit") && nextContent) {
		detail = firstFrontmatterDescription(nextContent) ?? `${nextContent.split("\n").length} line SKILL.md`;
	} else if (action.action === "patch") {
		const before = (previousContent ?? "").split("\n").length;
		const after = (nextContent ?? "").split("\n").length;
		detail = `${action.relativeTarget} (${before} → ${after} lines)`;
	} else if (action.action === "write_file") {
		detail = `${previousContent === null ? "adds" : "replaces"} ${action.relativeTarget}`;
	} else if (action.action === "remove_file") {
		detail = `removes ${action.relativeTarget}`;
	} else if (action.action === "delete") {
		detail = `removes ${displayPath(action.skillDir)}`;
	}

	return detail ? truncateGist(`${subject}: ${detail}`) : subject;
}

/**
 * Run every validation and guard an executor would run, compute the resulting
 * content, and scan it — without touching the filesystem. Errors surface at
 * stage time rather than at approval time.
 */
export async function previewSkillAction(
	roots: SkillRoots,
	params: SkillManageInput,
	overlay: SkillQueueOverlay | null = null,
): Promise<SkillActionPreview> {
	const action = await prepare(roots, params);
	let previousContent: string | null = null;
	let nextContent: string | null = null;

	switch (action.action) {
		case "create": {
			previousContent = await overlayReadIfExists(overlay, action.targetPath);
			if (previousContent !== null && !action.overwrite) {
				throw new Error(
					`Skill '${action.name}' already exists at ${action.targetPath}. Use action=edit, or create with overwrite=true.`,
				);
			}
			nextContent = action.content!;
			break;
		}
		case "edit": {
			previousContent = await overlayReadIfExists(overlay, action.targetPath);
			if (previousContent === null) throw new Error(`No SKILL.md exists for '${action.name}'; use action=create.`);
			nextContent = action.content!;
			break;
		}
		case "patch": {
			previousContent = await overlayReadIfExists(overlay, action.targetPath);
			if (previousContent === null) throw new Error(`No file exists at ${action.targetPath}.`);
			const occurrences = previousContent.split(action.oldString!).length - 1;
			if (occurrences !== 1) {
				throw new Error(`old_string must match exactly once in ${action.relativeTarget}; found ${occurrences}.`);
			}
			nextContent = assertContentWithinBounds(
				previousContent.replace(action.oldString!, action.newString!),
				"patched content",
			);
			break;
		}
		case "delete": {
			if (!(await overlaySkillDirExists(overlay, action.skillDir))) {
				throw new Error(`Skill '${action.name}' does not exist at ${action.skillDir}.`);
			}
			previousContent = await overlayReadIfExists(overlay, join(action.skillDir, SKILL_FILE_NAME));
			break;
		}
		case "write_file": {
			if (!(await overlayPathExists(overlay, join(action.skillDir, SKILL_FILE_NAME)))) {
				throw new Error(`Skill '${action.name}' does not exist; create it before adding supporting files.`);
			}
			previousContent = await overlayReadIfExists(overlay, action.targetPath);
			nextContent = action.content!;
			break;
		}
		case "remove_file": {
			previousContent = await overlayReadIfExists(overlay, action.targetPath);
			if (previousContent === null && !(await overlayPathExists(overlay, action.targetPath))) {
				throw new Error(`No file exists at ${action.targetPath}.`);
			}
			break;
		}
	}

	const securityFlags = nextContent === null ? [] : scanSkillContent(nextContent, action.relativeTarget);
	return { action, previousContent, nextContent, securityFlags, gist: buildGist(action, previousContent, nextContent) };
}

// ---------------------------------------------------------------------------
// Virtual queue overlay (staged-but-unapplied prior state)
// ---------------------------------------------------------------------------

/**
 * The prior state a not-yet-applied queued change would leave behind, used
 * only at STAGE time so a dependent change (e.g. `write_file` right after a
 * pending `create`) can be previewed before its dependency exists on disk.
 *
 * Deliberately permissive-only: the overlay is consulted ONLY where the real
 * filesystem has nothing. It can make a missing prerequisite appear present;
 * it can never hide or override a file that actually exists. That keeps direct
 * (approval-off) execution and every disk-backed check unchanged.
 *
 * Replay never consults an overlay: approval applies records oldest-first, so
 * by then the dependency is real on disk and the normal staleness check holds.
 */
export type SkillQueueOverlay = {
	/** Absolute path -> content a pending change would create. */
	files: Map<string, string>;
};

export function emptyQueueOverlay(): SkillQueueOverlay {
	return { files: new Map() };
}

function isUnder(parent: string, candidate: string): boolean {
	return candidate === parent || candidate.startsWith(`${parent}${sep}`);
}

/**
 * Fold the pending records that belong to `roots` (oldest first) into the set
 * of files they would create. Records for other skills roots are ignored, and
 * pending removals drop the entries they would delete.
 */
export function buildQueueOverlay(pending: PendingSkillChange[], roots: SkillRoots): SkillQueueOverlay {
	const overlay = emptyQueueOverlay();
	const scopeRoot = resolve(roots.skillsRoot);

	for (const record of pending) {
		if (resolve(record.skillsRoot) !== scopeRoot) continue;
		const skillDir = resolve(record.skillDir);
		const target = resolve(record.targetPath);
		if (!isUnder(scopeRoot, skillDir) || !isUnder(scopeRoot, target)) continue;

		if (record.action === "delete") {
			for (const key of [...overlay.files.keys()]) {
				if (isUnder(skillDir, key)) overlay.files.delete(key);
			}
			continue;
		}
		if (record.action === "remove_file") {
			overlay.files.delete(target);
			continue;
		}
		if (record.nextContent !== null) overlay.files.set(target, record.nextContent);
	}

	return overlay;
}

/** Disk wins; the overlay only fills a gap. */
async function overlayReadIfExists(overlay: SkillQueueOverlay | null, path: string): Promise<string | null> {
	const onDisk = await readIfExists(path);
	if (onDisk !== null) return onDisk;
	return overlay?.files.get(resolve(path)) ?? null;
}

async function overlayPathExists(overlay: SkillQueueOverlay | null, path: string): Promise<boolean> {
	if (await pathExists(path)) return true;
	return overlay?.files.has(resolve(path)) === true;
}

async function overlaySkillDirExists(overlay: SkillQueueOverlay | null, skillDir: string): Promise<boolean> {
	if (await pathExists(skillDir)) return true;
	if (!overlay) return false;
	const key = resolve(skillDir);
	for (const path of overlay.files.keys()) {
		if (isUnder(key, path)) return true;
	}
	return false;
}

// ---------------------------------------------------------------------------
// Durable staged approval queue
// ---------------------------------------------------------------------------

export const SKILL_QUEUE_VERSION = 1;

export type SkillChangeOrigin = {
	sessionId?: string;
	tool: "skill_manage";
	cwd: string;
};

/**
 * A staged, not-yet-applied mutation. `payload` is the full raw replay input:
 * approval re-validates it from scratch and re-runs the Task 2 executors.
 */
export type PendingSkillChange = {
	id: string;
	action: SkillAction;
	name: string;
	scope: SkillScope;
	category?: string;
	gist: string;
	origin: SkillChangeOrigin;
	createdAt: string;
	securityFlags: string[];
	payload: SkillManageInput;
	skillsRoot: string;
	agentsRoot: string;
	lockPath: string;
	skillDir: string;
	targetPath: string;
	relativeTarget: string;
	previousContent: string | null;
	nextContent: string | null;
	diff: string;
	lastError?: string;
};

export type SkillQueueFile = {
	version: number;
	pending: PendingSkillChange[];
	/** Absent or non-boolean reads as `true` — approval fails safe. */
	approvalEnabled?: boolean;
};

export type LoadedSkillQueue = SkillQueueFile & {
	/** Count of records dropped because they failed validation. */
	skipped: number;
};

// --- queue path (injectable for tests) -------------------------------------

export function defaultSkillQueuePath(home: string = homedir()): string {
	const xdg = process.env.XDG_STATE_HOME?.trim();
	const base = xdg && xdg !== "" ? xdg : join(home, ".local", "state");
	return join(base, "pi", "skill-manage-queue.json");
}

let queuePathOverride: string | null = (() => {
	const fromEnv = process.env.PI_SKILL_QUEUE_PATH?.trim();
	return fromEnv && fromEnv !== "" ? resolve(fromEnv) : null;
})();

/** Point the queue at an explicit file (tests, alternate profiles). `null` restores the default. */
export function setSkillQueuePath(path: string | null): void {
	queuePathOverride = path && path.trim() !== "" ? resolve(path) : null;
}

export function skillQueuePath(): string {
	return queuePathOverride ?? defaultSkillQueuePath();
}

// --- record validation -----------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}

function nullableString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

/**
 * Persisted queue IDs must be RFC 4122 UUIDs in the shape produced by
 * `crypto.randomUUID()` (version 4, RFC variant). Anything else is skipped.
 */
const RFC4122_RANDOM_UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPersistedRecordId(value: unknown): value is string {
	return typeof value === "string" && RFC4122_RANDOM_UUID_RE.test(value);
}

/**
 * Structural validation of one persisted record. The queue file is
 * user-writable, so anything malformed is skipped rather than trusted.
 * This is shape validation only — the payload is re-validated at replay.
 */
export function validatePendingRecord(value: unknown): PendingSkillChange | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;

	if (!isPersistedRecordId(record.id)) return null;
	const action = record.action;
	if (typeof action !== "string" || !SKILL_ACTIONS.includes(action as SkillAction)) return null;
	if (!isNonEmptyString(record.name)) return null;
	if (record.scope !== "global" && record.scope !== "project") return null;
	if (!isNonEmptyString(record.createdAt) || Number.isNaN(Date.parse(record.createdAt))) return null;
	if (!isNonEmptyString(record.skillsRoot) || !isNonEmptyString(record.skillDir)) return null;
	if (!isNonEmptyString(record.targetPath)) return null;
	if (!isAbsolute(record.skillsRoot) || !isAbsolute(record.skillDir) || !isAbsolute(record.targetPath)) return null;

	const payloadValue = record.payload;
	if (!payloadValue || typeof payloadValue !== "object" || Array.isArray(payloadValue)) return null;
	const payload = payloadValue as Record<string, unknown>;
	if (payload.action !== action || payload.name !== record.name) return null;

	const originValue = record.origin;
	const origin = originValue && typeof originValue === "object" && !Array.isArray(originValue)
		? (originValue as Record<string, unknown>)
		: {};

	return {
		id: record.id,
		action: action as SkillAction,
		name: record.name,
		scope: record.scope,
		category: isNonEmptyString(record.category) ? record.category : undefined,
		gist: isNonEmptyString(record.gist) ? record.gist : `${action} skill '${record.name}'`,
		origin: {
			sessionId: isNonEmptyString(origin.sessionId) ? origin.sessionId : undefined,
			tool: "skill_manage",
			cwd: isNonEmptyString(origin.cwd) ? origin.cwd : "",
		},
		createdAt: new Date(record.createdAt).toISOString(),
		securityFlags: Array.isArray(record.securityFlags)
			? record.securityFlags.filter((flag): flag is string => typeof flag === "string")
			: [],
		payload: payload as unknown as SkillManageInput,
		skillsRoot: record.skillsRoot,
		agentsRoot: isNonEmptyString(record.agentsRoot) ? record.agentsRoot : agentsRootForSkillsRoot(record.skillsRoot),
		lockPath: isNonEmptyString(record.lockPath) ? record.lockPath : lockPathForSkillsRoot(record.skillsRoot),
		skillDir: record.skillDir,
		targetPath: record.targetPath,
		relativeTarget: isNonEmptyString(record.relativeTarget)
			? record.relativeTarget
			: relative(record.skillsRoot, record.targetPath),
		previousContent: nullableString(record.previousContent),
		nextContent: nullableString(record.nextContent),
		diff: typeof record.diff === "string" ? record.diff : "(no diff recorded)",
		lastError: isNonEmptyString(record.lastError) ? record.lastError : undefined,
	};
}

export function emptySkillQueue(): LoadedSkillQueue {
	return { version: SKILL_QUEUE_VERSION, pending: [], approvalEnabled: true, skipped: 0 };
}

/**
 * Canonical queue order: oldest `createdAt` first, `id` as the deterministic
 * tie-breaker. Applied on every load so a hand-reordered queue file cannot
 * change the order in which /skills-queue, the review modal, or approve-all
 * process records.
 */
export function comparePendingChanges(a: PendingSkillChange, b: PendingSkillChange): number {
	const left = Date.parse(a.createdAt);
	const right = Date.parse(b.createdAt);
	if (left !== right) return left - right;
	if (a.id === b.id) return 0;
	return a.id < b.id ? -1 : 1;
}

export function sortPendingChanges(pending: PendingSkillChange[]): PendingSkillChange[] {
	return [...pending].sort(comparePendingChanges);
}

// --- queue I/O -------------------------------------------------------------

/**
 * Read and validate the queue. A missing, unreadable, or unparsable file
 * yields an empty queue with approval enabled — never a throw.
 */
export async function loadSkillQueue(path: string = skillQueuePath()): Promise<LoadedSkillQueue> {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch {
		return emptySkillQueue();
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return emptySkillQueue();
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptySkillQueue();
	const file = parsed as Record<string, unknown>;
	const rawPending = Array.isArray(file.pending) ? file.pending : [];

	const pending: PendingSkillChange[] = [];
	let skipped = 0;
	for (const candidate of rawPending) {
		const record = validatePendingRecord(candidate);
		if (record) pending.push(record);
		else skipped++;
	}

	return {
		version: typeof file.version === "number" ? file.version : SKILL_QUEUE_VERSION,
		// Order is derived, never taken from the file's array order.
		pending: sortPendingChanges(pending),
		// Fail safe: anything other than an explicit `false` means approval is on.
		approvalEnabled: file.approvalEnabled === false ? false : true,
		skipped,
	};
}

async function writeSkillQueue(queue: SkillQueueFile, path: string): Promise<void> {
	const body = {
		version: SKILL_QUEUE_VERSION,
		approvalEnabled: queue.approvalEnabled === false ? false : true,
		pending: queue.pending,
	};
	await atomicWriteFile(path, `${JSON.stringify(body, null, 2)}\n`);
}

/**
 * Reload from disk, apply `mutator`, and atomically rewrite — all inside
 * `withFileMutationQueue` on the queue path so concurrent tool calls in one
 * process serialize.
 *
 * Residual race (documented, accepted per plan): two separate Pi processes have
 * independent mutation queues, so a cross-process interleaving can still lose a
 * write. Reload-before-write keeps the window to a single atomic rename, and
 * "record already gone" is treated as a benign no-op everywhere.
 */
export async function mutateSkillQueue<T>(
	mutator: (queue: LoadedSkillQueue) => T | Promise<T>,
	path: string = skillQueuePath(),
): Promise<T> {
	return withFileMutationQueue(path, async () => {
		const queue = await loadSkillQueue(path);
		const outcome = await mutator(queue);
		await writeSkillQueue(queue, path);
		return outcome;
	});
}

export async function pendingSkillChanges(path: string = skillQueuePath()): Promise<PendingSkillChange[]> {
	return (await loadSkillQueue(path)).pending;
}

export async function pendingSkillChangeCount(path: string = skillQueuePath()): Promise<number> {
	return (await loadSkillQueue(path)).pending.length;
}

// --- approval toggle -------------------------------------------------------

export async function isSkillApprovalEnabled(path: string = skillQueuePath()): Promise<boolean> {
	return (await loadSkillQueue(path)).approvalEnabled !== false;
}

export async function setSkillApprovalEnabled(enabled: boolean, path: string = skillQueuePath()): Promise<boolean> {
	const value = await mutateSkillQueue((queue) => {
		queue.approvalEnabled = enabled;
		return enabled;
	}, path);
	await emitSkillQueueChanged(path);
	return value;
}

// --- queueChanged hook -----------------------------------------------------

export type SkillQueueSnapshot = {
	pending: PendingSkillChange[];
	approvalEnabled: boolean;
	skipped: number;
};

export type SkillQueueChangedListener = (snapshot: SkillQueueSnapshot) => void | Promise<void>;

const queueChangedListeners: SkillQueueChangedListener[] = [];

/** Single callback-list subscription used by the footer count and the overlay. */
export function onSkillQueueChanged(listener: SkillQueueChangedListener): () => void {
	queueChangedListeners.push(listener);
	return () => {
		const index = queueChangedListeners.indexOf(listener);
		if (index >= 0) queueChangedListeners.splice(index, 1);
	};
}

export function clearSkillQueueListeners(): void {
	queueChangedListeners.length = 0;
}

/** Fired after every stage, approve, reject, and approval toggle. */
export async function emitSkillQueueChanged(path: string = skillQueuePath()): Promise<void> {
	if (queueChangedListeners.length === 0) return;
	const queue = await loadSkillQueue(path);
	const snapshot: SkillQueueSnapshot = {
		pending: queue.pending,
		approvalEnabled: queue.approvalEnabled !== false,
		skipped: queue.skipped,
	};
	for (const listener of [...queueChangedListeners]) {
		try {
			await listener(snapshot);
		} catch {
			// A broken subscriber must never break queue mutation.
		}
	}
}

// --- footer status (skills review: N) --------------------------------------

/** Distinct footer key; coexists with polished-footer and other extension statuses. */
export const SKILL_MANAGE_STATUS_KEY = "skill-manage";

/**
 * Footer text for the pending-review count.
 * Hidden at zero — the count is a call to action, not a permanent gauge.
 * Clear mechanism (Pi 0.83): `ctx.ui.setStatus(key, undefined)`.
 */
export function skillsReviewStatusText(count: number): string | undefined {
	return count > 0 ? `skills review: ${count}` : undefined;
}

export function applySkillsReviewStatus(
	setStatus: (key: string, text: string | undefined) => void,
	count: number,
): void {
	setStatus(SKILL_MANAGE_STATUS_KEY, skillsReviewStatusText(count));
}

export type SkillsReviewFooterBinding = {
	/** Load persisted queue and paint; subscribe to local queueChanged updates. */
	start: () => Promise<void>;
	/** Clear the status key and unsubscribe. Idempotent. */
	stop: () => void;
};

/**
 * Bind the pending-review footer count to `setStatus`.
 *
 * Cross-session staleness (accepted): another Pi process can mutate the shared
 * queue file without notifying this session. The footer refreshes on the next
 * local stage/approve/reject/toggle via `queueChanged` — no polling.
 */
export function bindSkillsReviewFooterStatus(
	setStatus: (key: string, text: string | undefined) => void,
	options: {
		loadPendingCount?: () => Promise<number>;
		subscribe?: (listener: SkillQueueChangedListener) => () => void;
	} = {},
): SkillsReviewFooterBinding {
	const loadPendingCount =
		options.loadPendingCount ?? (async () => (await loadSkillQueue()).pending.length);
	const subscribe = options.subscribe ?? onSkillQueueChanged;
	let unsubscribe: (() => void) | undefined;

	return {
		async start() {
			unsubscribe?.();
			unsubscribe = undefined;
			applySkillsReviewStatus(setStatus, await loadPendingCount());
			unsubscribe = subscribe((snapshot) => {
				applySkillsReviewStatus(setStatus, snapshot.pending.length);
			});
		},
		stop() {
			unsubscribe?.();
			unsubscribe = undefined;
			setStatus(SKILL_MANAGE_STATUS_KEY, undefined);
		},
	};
}

// --- staging ---------------------------------------------------------------

let lastStagedMillis = 0;

/**
 * Strictly increasing ISO timestamp. `Date.now()` has millisecond resolution,
 * so two stages in the same tick would otherwise tie and fall back to the id
 * tie-breaker, reordering an intentional dependency chain.
 */
function nextStagedTimestamp(): string {
	const millis = Math.max(Date.now(), lastStagedMillis + 1);
	lastStagedMillis = millis;
	return new Date(millis).toISOString();
}

export async function stageSkillAction(
	roots: SkillRoots,
	params: SkillManageInput,
	origin: SkillChangeOrigin,
	path: string = skillQueuePath(),
): Promise<{ record: PendingSkillChange; queueDepth: number }> {
	// Preview against the projected state of the existing queue so a dependent
	// change (write_file after a pending create) can stage. Every path, bound,
	// lock, and containment check still runs against the real roots.
	const existing = await loadSkillQueue(path);
	const preview = await previewSkillAction(roots, params, buildQueueOverlay(existing.pending, roots));
	const { action } = preview;
	const diff = await unifiedDiff(action.relativeTarget, preview.previousContent, preview.nextContent);

	const record: PendingSkillChange = {
		id: randomUUID(),
		action: action.action,
		name: action.name,
		scope: action.scope,
		category: action.category,
		gist: preview.gist,
		origin: { sessionId: origin.sessionId, tool: "skill_manage", cwd: origin.cwd },
		createdAt: nextStagedTimestamp(),
		securityFlags: preview.securityFlags,
		// Full raw replay payload — re-validated from scratch at approval time.
		payload: { ...params, action: action.action, name: action.name, scope: action.scope },
		skillsRoot: roots.skillsRoot,
		agentsRoot: roots.agentsRoot,
		lockPath: roots.lockPath,
		skillDir: action.skillDir,
		targetPath: action.targetPath,
		relativeTarget: action.relativeTarget,
		previousContent: preview.previousContent,
		nextContent: preview.nextContent,
		diff,
	};

	const queueDepth = await mutateSkillQueue((queue) => {
		queue.pending.push(record);
		return queue.pending.length;
	}, path);

	await emitSkillQueueChanged(path);
	return { record, queueDepth };
}

// --- replay ----------------------------------------------------------------

export type ReplayOutcome =
	| { ok: true; message: string; applied: boolean; result?: SkillActionResult }
	| { ok: false; error: string };

/**
 * Live authority for replaying staged changes.
 *
 * `trustedProjectCwd` must come from a live harness context — the current
 * `ctx.cwd` observed while `ctx.isProjectTrusted()` is true. It must never be
 * read back out of the user-writable queue file. `null` means "no trusted
 * project is active right now", which makes every project-scoped record
 * unreplayable (and therefore retained).
 */
export type SkillReplayAuthorization = {
	trustedProjectCwd: string | null;
};

/** The safe default: global records replay, project records do not. */
export const NO_REPLAY_AUTHORIZATION: SkillReplayAuthorization = { trustedProjectCwd: null };

/** Build a replay authorization from a live command/tool context. */
export function replayAuthorizationFor(ctx: { cwd: string; isProjectTrusted(): boolean }): SkillReplayAuthorization {
	try {
		return { trustedProjectCwd: ctx.isProjectTrusted() ? ctx.cwd : null };
	} catch {
		return NO_REPLAY_AUTHORIZATION;
	}
}

/** realpath-resolved absolute form, used for every root/path comparison. */
async function canonicalPath(path: string): Promise<string> {
	return resolveExistingPrefix(resolve(path));
}

async function canonicalDirectory(path: unknown, label: string): Promise<string> {
	if (typeof path !== "string" || path.trim() === "" || !isAbsolute(path)) {
		throw new Error(`${label} is not an absolute path; refusing replay.`);
	}
	if (path.includes("\0") || path.split(/[\\/]+/).includes("..")) {
		throw new Error(`${label} contains a traversing segment; refusing replay.`);
	}
	return canonicalPath(path);
}

/**
 * Recompute the authoritative roots for a record from its validated scope and a
 * LIVE authorization. Every persisted field — `origin.cwd`, `skillsRoot`,
 * `agentsRoot`, `lockPath`, `skillDir`, `targetPath` — is an untrusted claim
 * checked against this result, never a source of authority.
 *
 * Global records are self-contained: ~/dotfiles/skills plus derived paths.
 * Project records require `authorization.trustedProjectCwd`; the roots are
 * derived from that live cwd, and the record's staged origin must canonically
 * resolve to the same directory.
 */
export async function canonicalReplayRoots(
	record: PendingSkillChange,
	authorization: SkillReplayAuthorization = NO_REPLAY_AUTHORIZATION,
): Promise<SkillRoots> {
	if (record.scope === "global") return resolveSkillRoots("global", homedir(), homedir());
	if (record.scope !== "project") throw new Error(`Unknown scope '${String(record.scope)}' on queue record.`);

	const stagedClaim = record.origin?.cwd ?? "";
	const trusted = authorization?.trustedProjectCwd ?? null;
	if (trusted === null) {
		throw new Error(
			`This project-scoped change was staged in ${stagedClaim === "" ? "another project" : displayPath(stagedClaim)}. ` +
				"Keeping it queued: open that project with project trust enabled and run /skills-review there.",
		);
	}

	// Authority: the live, verified trusted project directory.
	const liveCwd = await canonicalDirectory(trusted, "Trusted project cwd");
	// Claim: what the queue says it was staged against.
	const stagedCwd = await canonicalDirectory(stagedClaim, "Queue record origin cwd");
	if (liveCwd !== stagedCwd) {
		throw new Error(
			`This project-scoped change was staged in ${displayPath(stagedCwd)} but the current trusted project is ` +
				`${displayPath(liveCwd)}. Keeping it queued: review it from the original trusted project.`,
		);
	}

	return resolveSkillRoots("project", liveCwd);
}

export type ReplayRootsResolver = (record: PendingSkillChange) => SkillRoots | Promise<SkillRoots>;

export type ReplayOptions = {
	/** Live trusted-project authorization; omitted means "none". */
	authorization?: SkillReplayAuthorization;
	/** Explicit root resolver, for temp-directory tests. Takes precedence. */
	resolveRoots?: ReplayRootsResolver;
};

let replayRootsResolver: ReplayRootsResolver | null = null;

/**
 * Inject the expected roots for replay. Intended only for temp-directory tests;
 * production leaves this null and uses `canonicalReplayRoots`.
 */
export function setSkillReplayRootsResolver(resolver: ReplayRootsResolver | null): void {
	replayRootsResolver = resolver;
}

export async function expectedReplayRoots(
	record: PendingSkillChange,
	options: ReplayOptions = {},
): Promise<SkillRoots> {
	const resolver = options.resolveRoots ?? replayRootsResolver;
	if (resolver) return resolver(record);
	return canonicalReplayRoots(record, options.authorization);
}

/** The record's own root and path claims must match the recomputed roots. */
async function assertRecordRootsMatch(expected: SkillRoots, record: PendingSkillChange): Promise<void> {
	const mismatches: string[] = [];
	if ((await canonicalPath(record.skillsRoot)) !== (await canonicalPath(expected.skillsRoot))) mismatches.push("skillsRoot");
	if ((await canonicalPath(record.agentsRoot)) !== (await canonicalPath(expected.agentsRoot))) mismatches.push("agentsRoot");
	if ((await canonicalPath(record.lockPath)) !== (await canonicalPath(expected.lockPath))) mismatches.push("lockPath");
	if (mismatches.length > 0) {
		throw new Error(
			`Queue record roots do not match the canonical roots for scope '${record.scope}' (${mismatches.join(", ")}); refusing replay.`,
		);
	}
	const root = await canonicalPath(expected.skillsRoot);
	if (!isUnder(root, await canonicalPath(record.skillDir))) {
		throw new Error(`Queue record skillDir escapes ${expected.skillsRoot}; refusing replay.`);
	}
	if (!isUnder(root, await canonicalPath(record.targetPath))) {
		throw new Error(`Queue record targetPath escapes ${expected.skillsRoot}; refusing replay.`);
	}
}

async function currentStateFor(record: PendingSkillChange, action: ValidatedSkillAction) {
	if (action.action === "delete") {
		return {
			exists: await pathExists(action.skillDir),
			content: await readIfExists(join(action.skillDir, SKILL_FILE_NAME)),
		};
	}
	return { exists: await pathExists(action.targetPath), content: await readIfExists(action.targetPath) };
}

/**
 * Re-validate a persisted record from scratch and re-run the core executor.
 *
 * Never trusts the record: the roots are recomputed from scope and provenance,
 * names, categories, paths, bounds, lock-file status, and realpath containment
 * are all re-checked, and the recomputed target must match the one stored at
 * stage time.
 */
export async function replayPendingChange(
	record: PendingSkillChange,
	options: ReplayOptions = {},
): Promise<ReplayOutcome> {
	try {
		// Authority is the recomputed roots, not the persisted ones.
		const roots = await expectedReplayRoots(record, options);
		await assertRecordRootsMatch(roots, record);

		const action = validateSkillAction(record.payload, roots);
		if (action.action !== record.action || action.name !== record.name) {
			return { ok: false, error: "Queue record disagrees with its payload; refusing replay." };
		}
		if (
			(await canonicalPath(action.targetPath)) !== (await canonicalPath(record.targetPath)) ||
			(await canonicalPath(action.skillDir)) !== (await canonicalPath(record.skillDir))
		) {
			return { ok: false, error: `Replay target changed (${action.targetPath} ≠ ${record.targetPath}); refusing replay.` };
		}
		await assertNotLockedSkill(roots, action);
		await assertResolvedInside(roots.skillsRoot, action.skillDir);

		const state = await currentStateFor(record, action);

		// Planned idempotency: the intended end state may already be in place.
		if (record.nextContent === null) {
			if (!state.exists) {
				return { ok: true, applied: false, message: `Nothing to do: ${action.relativeTarget || action.name} is already absent.` };
			}
		} else if (state.content !== null && state.content === record.nextContent) {
			return { ok: true, applied: false, message: `Nothing to do: ${action.relativeTarget} already matches the staged content.` };
		}

		// Staleness: the target must still look the way it did when staged.
		if (state.content !== record.previousContent) {
			return {
				ok: false,
				error: `Stale — re-review: ${action.relativeTarget || action.name} changed on disk since this change was staged.`,
			};
		}

		const result = await executeSkillAction(roots, record.payload);
		return { ok: true, applied: true, message: result.message, result };
	} catch (error) {
		return { ok: false, error: errorMessage(error) };
	}
}

// --- approve / reject ------------------------------------------------------

export type ApprovalOutcome = ReplayOutcome & { removed: boolean };

async function removeRecord(id: string, path: string): Promise<boolean> {
	return mutateSkillQueue((queue) => {
		const index = queue.pending.findIndex((item) => item.id === id);
		if (index < 0) return false;
		queue.pending.splice(index, 1);
		return true;
	}, path);
}

async function markRecordError(id: string, message: string, path: string): Promise<void> {
	await mutateSkillQueue((queue) => {
		const record = queue.pending.find((item) => item.id === id);
		if (record) record.lastError = message;
	}, path);
}

/** Replay one record; remove it only after a successful replay. */
export async function approvePendingChange(
	id: string,
	path: string = skillQueuePath(),
	options: ReplayOptions = {},
): Promise<ApprovalOutcome> {
	const queue = await loadSkillQueue(path);
	const record = queue.pending.find((item) => item.id === id);
	if (!record) {
		// Another session already settled it — benign no-op.
		return { ok: true, applied: false, removed: false, message: `Change ${id.slice(0, 8)} is no longer queued.` };
	}

	const outcome = await replayPendingChange(record, options);
	if (outcome.ok) {
		const removed = await removeRecord(id, path);
		await emitSkillQueueChanged(path);
		return { ...outcome, removed };
	}

	await markRecordError(id, outcome.error, path);
	await emitSkillQueueChanged(path);
	return { ...outcome, removed: false };
}

export type ApproveAllOutcome = {
	approved: number;
	remaining: number;
	failure?: { id: string; name: string; error: string };
};

/** Oldest first; stops at the first failure and leaves the remainder intact. */
export async function approveAllPendingChanges(
	path: string = skillQueuePath(),
	options: ReplayOptions = {},
): Promise<ApproveAllOutcome> {
	const initial = await loadSkillQueue(path);
	let approved = 0;

	for (const record of initial.pending) {
		const outcome = await approvePendingChange(record.id, path, options);
		if (!outcome.ok) {
			return {
				approved,
				remaining: await pendingSkillChangeCount(path),
				failure: { id: record.id, name: record.name, error: outcome.error },
			};
		}
		approved++;
	}

	return { approved, remaining: await pendingSkillChangeCount(path) };
}

/** Drops a record. Never touches skill files. */
export async function rejectPendingChange(id: string, path: string = skillQueuePath()): Promise<boolean> {
	const removed = await removeRecord(id, path);
	await emitSkillQueueChanged(path);
	return removed;
}

/** Drops every record. Never touches skill files. */
export async function rejectAllPendingChanges(path: string = skillQueuePath()): Promise<number> {
	const count = await mutateSkillQueue((queue) => {
		const total = queue.pending.length;
		queue.pending = [];
		return total;
	}, path);
	await emitSkillQueueChanged(path);
	return count;
}

// --- stage-or-apply dispatch ----------------------------------------------

export type DispatchOutcome =
	| { staged: true; record: PendingSkillChange; queueDepth: number }
	| { staged: false; result: SkillActionResult };

/**
 * With approval on (the default, and the safe default when the flag is absent
 * or corrupt) all six actions stage. With approval off, unflagged actions apply
 * immediately; security-flagged content always stages. This is Pi-specific
 * hardening beyond Hermes.
 */
export async function dispatchSkillAction(
	roots: SkillRoots,
	params: SkillManageInput,
	origin: SkillChangeOrigin,
	path: string = skillQueuePath(),
): Promise<DispatchOutcome> {
	const approvalEnabled = await isSkillApprovalEnabled(path);
	if (approvalEnabled) {
		return { staged: true, ...(await stageSkillAction(roots, params, origin, path)) };
	}

	const preview = await previewSkillAction(roots, params);
	if (preview.securityFlags.length > 0) {
		return { staged: true, ...(await stageSkillAction(roots, params, origin, path)) };
	}

	return { staged: false, result: await executeSkillAction(roots, params) };
}

// ---------------------------------------------------------------------------
// Review UI
// ---------------------------------------------------------------------------

export function formatAge(createdAt: string, now: number = Date.now()): string {
	const then = Date.parse(createdAt);
	if (Number.isNaN(then)) return "unknown";
	const seconds = Math.max(0, Math.round((now - then) / 1000));
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
	if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
	return `${Math.round(seconds / 86400)}d`;
}

/** Oldest-first one-line listing used by /skills-queue and the widget. */
export function formatQueueLines(pending: PendingSkillChange[], now: number = Date.now()): string[] {
	return pending.map((item, index) => {
		const flags = item.securityFlags.length > 0 ? ` ⚠ ${item.securityFlags.length} flag(s)` : "";
		const failed = item.lastError ? ` ✗ ${item.lastError}` : "";
		return `${index + 1}. [${item.id.slice(0, 8)}] ${item.action} ${item.name} — ${item.gist} (${formatAge(item.createdAt, now)} ago)${flags}${failed}`;
	});
}

type ReviewChoice = "approve" | "reject" | "skip" | "approve-all" | "reject-all" | "quit" | undefined;

class SkillDiffModal implements Component {
	private scroll = 0;
	private confirm: "approve-all" | "reject-all" | null = null;
	private readonly diffLines: string[];

	constructor(
		private readonly theme: Theme,
		private readonly change: PendingSkillChange,
		private readonly total: number,
		private readonly done: (result: ReviewChoice) => void,
	) {
		this.diffLines = change.diff.split("\n");
	}

	handleInput(data: string): void {
		if (this.confirm !== null) {
			const pending = this.confirm;
			if (data === "y" || data === "Y") return this.done(pending);
			this.confirm = null;
			return;
		}
		if (matchesKey(data, "escape") || data === "q") return this.done("quit");
		if (data === "a") return this.done("approve");
		if (data === "r") return this.done("reject");
		if (data === "s") return this.done("skip");
		if (data === "A") {
			this.confirm = "approve-all";
			return;
		}
		if (data === "R") {
			this.confirm = "reject-all";
			return;
		}
		if (matchesKey(data, "up") || data === "k") this.scroll = Math.max(0, this.scroll - 1);
		if (matchesKey(data, "down") || data === "j") this.scroll = Math.min(this.maxScroll(), this.scroll + 1);
		if (matchesKey(data, "pageUp")) this.scroll = Math.max(0, this.scroll - 10);
		if (matchesKey(data, "pageDown")) this.scroll = Math.min(this.maxScroll(), this.scroll + 10);
	}

	render(width: number): string[] {
		const w = Math.max(60, Math.min(width - 2, 140));
		const inner = w - 2;
		const th = this.theme;
		const row = (content = "") => th.fg("border", "│") + padAnsi(content, inner) + th.fg("border", "│");
		const visibleRows = 24;
		const shown = this.diffLines.slice(this.scroll, this.scroll + visibleRows);
		const lines: string[] = [];

		lines.push(th.fg("border", `╭${"─".repeat(inner)}╮`));
		lines.push(
			row(` ${th.fg("accent", th.bold(`Skill update: ${this.change.name}`))} ${th.fg("dim", `(${this.total} pending)`)}`),
		);
		lines.push(row(` ${th.fg("muted", "Gist:")} ${this.change.gist}`));
		lines.push(
			row(
				` ${th.fg("muted", "Action:")} ${this.change.action}   ${th.fg("muted", "Target:")} ${displayPath(this.change.targetPath)}`,
			),
		);
		lines.push(
			row(
				` ${th.fg("muted", "Staged:")} ${formatAge(this.change.createdAt)} ago   ${th.fg("muted", "Id:")} ${this.change.id.slice(0, 8)}`,
			),
		);
		for (const flag of this.change.securityFlags) lines.push(row(` ${th.fg("warning", `⚠ ${flag}`)}`));
		if (this.change.lastError) lines.push(row(` ${th.fg("error", `✗ ${this.change.lastError}`)}`));
		lines.push(row(` ${th.fg("dim", "a approve • r reject • s skip • A approve-all • R reject-all • q/esc quit • ↑↓/j/k scroll")}`));
		if (this.confirm !== null) {
			lines.push(row(` ${th.fg("warning", `Confirm ${this.confirm.replace("-", " ")}? press y to confirm, any other key to cancel`)}`));
		}
		lines.push(row(th.fg("borderMuted", "─".repeat(Math.max(0, inner - 1)))));

		for (const line of shown) lines.push(row(` ${this.styleDiffLine(line)}`));
		for (let i = shown.length; i < visibleRows; i++) lines.push(row());

		const position =
			this.diffLines.length === 0
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

async function listQueue(ctx: ExtensionCommandContext): Promise<void> {
	const queue = await loadSkillQueue();
	if (queue.skipped > 0) {
		ctx.ui.notify(`Skipped ${queue.skipped} malformed record(s) in ${displayPath(skillQueuePath())}.`, "warning");
	}
	if (queue.pending.length === 0) {
		ctx.ui.notify("No pending skill updates.", "info");
		ctx.ui.setWidget("skill-review-queue", undefined);
		return;
	}

	const lines = formatQueueLines(queue.pending);
	ctx.ui.notify(`${queue.pending.length} pending skill update(s).`, "info");
	ctx.ui.setWidget(
		"skill-review-queue",
		["Pending skill updates (oldest first):", ...lines, "Run /skills-review to open the diff modal (or press Alt+S)."],
		{ placement: "belowEditor" },
	);
}

async function reviewQueue(ctx: ExtensionCommandContext): Promise<void> {
	const skipped = new Set<string>();
	// Live authority, re-read from the harness on every approval below.
	const replayOptions = (): ReplayOptions => ({ authorization: replayAuthorizationFor(ctx) });

	for (;;) {
		// Reload every iteration: another session may have settled records.
		const queue = await loadSkillQueue();
		const change = queue.pending.find((item) => !skipped.has(item.id));
		if (!change) {
			ctx.ui.notify(queue.pending.length === 0 ? "No pending skill updates." : "No more changes to review.", "info");
			if (queue.pending.length === 0) ctx.ui.setWidget("skill-review-queue", undefined);
			return;
		}

		const result = await ctx.ui.custom<ReviewChoice>(
			(_tui, theme, _keybindings, done) => new SkillDiffModal(theme, change, queue.pending.length, done),
			{ overlay: true, overlayOptions: { width: "90%", maxHeight: "85%", anchor: "center", margin: 1 } },
		);

		if (result === "approve") {
			const outcome = await approvePendingChange(change.id, skillQueuePath(), replayOptions());
			if (outcome.ok) ctx.ui.notify(outcome.message, "info");
			else {
				ctx.ui.notify(`Approve failed for ${change.name}: ${outcome.error}`, "error");
				skipped.add(change.id);
			}
			continue;
		}

		if (result === "reject") {
			await rejectPendingChange(change.id);
			ctx.ui.notify(`Rejected skill update: ${change.name}`, "info");
			continue;
		}

		if (result === "approve-all") {
			const outcome = await approveAllPendingChanges(skillQueuePath(), replayOptions());
			if (outcome.failure) {
				ctx.ui.notify(
					`Approved ${outcome.approved}; stopped at ${outcome.failure.name}: ${outcome.failure.error}. ${outcome.remaining} left.`,
					"error",
				);
				return;
			}
			ctx.ui.notify(`Approved ${outcome.approved} skill update(s).`, "info");
			ctx.ui.setWidget("skill-review-queue", undefined);
			return;
		}

		if (result === "reject-all") {
			const count = await rejectAllPendingChanges();
			ctx.ui.notify(`Rejected ${count} skill update(s); no files were changed.`, "info");
			ctx.ui.setWidget("skill-review-queue", undefined);
			return;
		}

		if (result === "skip") {
			skipped.add(change.id);
			continue;
		}

		return;
	}
}

// ---------------------------------------------------------------------------
// Pending proposals overlay (Alt+S)
//
// Browse-and-inspect surface over the same durable queue the /skills-review
// modal drives. It never mutates the queue: it only reads records and hands a
// chosen one to the selection seam below.
// ---------------------------------------------------------------------------

/** Visible row budget; the SelectList scrolls beyond this. */
export const PENDING_OVERLAY_MAX_ROWS = 12;

export type PendingOverlayResult =
	/** Escape (or cancel): stop browsing. */
	| { kind: "close" }
	/** Queue changed under us: reload and reopen. */
	| { kind: "refresh" }
	/** Enter on a row. */
	| { kind: "select"; id: string };

/** Compact one-line label: skill name, action, relative age, and flag markers. */
export function formatOverlayLabel(record: PendingSkillChange, now: number = Date.now()): string {
	const flags = record.securityFlags.length > 0 ? ` ⚠${record.securityFlags.length}` : "";
	const failed = record.lastError ? " ✗" : "";
	return `${record.name} · ${record.action} · ${formatAge(record.createdAt, now)} ago${flags}${failed}`;
}

/**
 * One row per pending record, oldest first. Order is recomputed here with the
 * same canonical comparator the queue loader uses, so a hand-reordered queue
 * file cannot change what the overlay shows.
 */
export function buildPendingOverlayItems(
	pending: PendingSkillChange[],
	now: number = Date.now(),
	width = 100,
): SelectItem[] {
	const gistWidth = Math.max(24, Math.min(width, 160) - 12);
	return sortPendingChanges(pending).map((record) => ({
		value: record.id,
		label: formatOverlayLabel(record, now),
		description: truncateToWidth(record.gist.replace(/\s+/g, " ").trim(), gistWidth, "…"),
	}));
}

export type PendingOverlayControls = {
	/** Close the overlay so the caller can reload and reopen it. */
	requestRefresh: () => void;
};

export type PendingOverlayDeps = {
	tui: { requestRender(): void };
	theme: Theme;
	pending: PendingSkillChange[];
	skipped: number;
	now?: number;
	width?: number;
	/** True once a queueChanged landed while this overlay was open. */
	isStale: () => boolean;
	done: (result: PendingOverlayResult) => void;
	onControls?: (controls: PendingOverlayControls) => void;
};

/**
 * Build the overlay component.
 *
 * Keyboard-only limitation: Pi 0.83's `SelectList` exposes no mouse or click
 * handling (`handleInput` receives key data only, and there is no click hook),
 * so rows cannot be selected with the mouse. Navigation is ↑↓/pageUp/pageDown,
 * selection is Enter, and Escape cancels.
 */
export function createPendingProposalsOverlay(deps: PendingOverlayDeps): Component {
	const theme = deps.theme;
	const items = buildPendingOverlayItems(deps.pending, deps.now ?? Date.now(), deps.width ?? 100);

	let settled = false;
	const finish = (result: PendingOverlayResult) => {
		if (settled) return;
		settled = true;
		deps.done(result);
	};

	const container = new Container();
	container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
	container.addChild(
		new Text(theme.fg("accent", theme.bold(`Pending skill proposals (${items.length})`)), 1, 0),
	);
	if (deps.skipped > 0) {
		container.addChild(new Text(theme.fg("warning", `⚠ skipped ${deps.skipped} malformed record(s)`), 1, 0));
	}

	const selectList = new SelectList(items, Math.min(Math.max(items.length, 1), PENDING_OVERLAY_MAX_ROWS), {
		selectedPrefix: (t: string) => theme.fg("accent", t),
		selectedText: (t: string) => theme.fg("accent", t),
		description: (t: string) => theme.fg("muted", t),
		scrollInfo: (t: string) => theme.fg("dim", t),
		noMatch: (t: string) => theme.fg("warning", t),
	});
	selectList.onSelect = (item: SelectItem) => finish({ kind: "select", id: item.value });
	selectList.onCancel = () => finish({ kind: "close" });
	container.addChild(selectList);

	container.addChild(
		new Text(theme.fg("dim", "↑↓ navigate • enter inspect • esc close • keyboard only"), 1, 0),
	);
	container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

	deps.onControls?.({ requestRefresh: () => finish({ kind: "refresh" }) });

	return {
		render: (w: number) => container.render(w),
		invalidate: () => container.invalidate(),
		handleInput: (data: string) => {
			// Second refresh path: if the queueChanged notification arrived while
			// this overlay held input, the next keypress reloads instead of acting
			// on a stale row.
			if (deps.isStale()) {
				finish({ kind: "refresh" });
				return;
			}
			selectList.handleInput(data);
			deps.tui.requestRender();
		},
	};
}

// --- selection handoff seam ------------------------------------------------

/**
 * The subset of Pi 0.83's `TUI` used to hand the terminal to a foreground
 * child. `stop()` releases raw mode and the alternate render loop, `start()`
 * reacquires it, and `requestRender(true)` forces a full repaint — the same
 * sequence Pi's own Ctrl+G external-editor path uses.
 */
export type SkillReviewTui = {
	stop(): void;
	start(): void;
	requestRender(force?: boolean): void;
};

export type SkillProposalSelection = {
	record: PendingSkillChange;
	ctx: ExtensionContext;
	/**
	 * The live TUI captured from the overlay factory. Absent in tests and in
	 * non-TUI hosts; the editor handoff then skips suspend/restore.
	 */
	tui?: SkillReviewTui;
};

export type SkillProposalSelectionHandler = (selection: SkillProposalSelection) => void | Promise<void>;

let proposalSelectionHandler: SkillProposalSelectionHandler | null = null;

/** Install the inspection handoff. `null` restores the default notice. */
export function setSkillProposalSelectionHandler(handler: SkillProposalSelectionHandler | null): void {
	proposalSelectionHandler = handler;
}

export function getSkillProposalSelectionHandler(): SkillProposalSelectionHandler | null {
	return proposalSelectionHandler;
}

/**
 * Called with a still-queued record after the overlay closes. The default is a
 * notice only — no editor process and no artifacts are created here.
 */
export async function handleSkillProposalSelection(selection: SkillProposalSelection): Promise<void> {
	if (proposalSelectionHandler) {
		await proposalSelectionHandler(selection);
		return;
	}
	const { record, ctx } = selection;
	ctx.ui.notify(
		`${record.action} ${record.name} — ${record.gist}. Inspection opens in a later step; use /skills-review to approve or reject.`,
		"info",
	);
}

// ---------------------------------------------------------------------------
// Read-only $EDITOR review handoff
//
// Selecting a row in the pending-proposals overlay writes a throwaway markdown
// artifact describing exactly what the staged record would do, then opens it in
// the user's editor. The artifact is a *report*, never an input: it is never
// read back, and neither the queue nor the skills tree is touched here.
// Approval stays exclusively with /skills-review.
//
// Blocking-editor limitation: the handoff waits for the child process to exit
// before restoring the TUI. Editors that fork and return immediately (VS Code,
// Sublime, Zed, and similar GUI editors) will appear to "flash" — the TUI comes
// back while the window is still open. Configure a blocking invocation, e.g.
// `EDITOR='code --wait'`, `EDITOR='subl -w'`, `EDITOR='zed --wait'`.
//
// Quoting limitation: the editor value is split on whitespace only. There is no
// shell, so there is no quoting, globbing, variable expansion, or operator
// support. `EDITOR='vim -c "set ft=markdown"'` becomes the literal argv
// ["vim", "-c", '"set', 'ft=markdown"']. Use a wrapper script for anything that
// needs quoting.
// ---------------------------------------------------------------------------

/** Shown when neither $EDITOR nor $VISUAL is usable. Exact wording is contractual. */
export const NO_REVIEW_EDITOR_NOTICE =
	"Set $EDITOR or $VISUAL to review proposals in an editor; falling back to the in-TUI diff (/skills-review).";

/** Bold banner at the top of every artifact. Exact wording is contractual. */
export const REVIEW_ARTIFACT_WARNING =
	"READ-ONLY REVIEW — edits to this file are ignored. Opening this file does not approve the change. Approve/reject via /skills-review.";

export type ResolvedReviewEditor = {
	/** Which variable supplied the value. */
	source: "EDITOR" | "VISUAL";
	/** The raw, untrimmed-of-meaning value as configured. */
	value: string;
	/** argv[0] followed by argv[1..]; never passed through a shell. */
	argv: string[];
};

/**
 * Split an editor command into argv on whitespace.
 *
 * Deliberately dumb: no shell, so no quoting, escaping, globbing, or operators
 * are honoured. `'vim; touch /tmp/pwned'` yields `["vim;", "touch",
 * "/tmp/pwned"]`, which fails to spawn instead of running two commands.
 */
export function splitEditorCommand(value: string): string[] {
	return value.trim().split(/\s+/).filter((part) => part.length > 0);
}

/**
 * Resolve the review editor: nonempty `$EDITOR` first, then nonempty `$VISUAL`.
 * Returns `null` when neither is set to anything but whitespace.
 */
export function resolveReviewEditor(env: Record<string, string | undefined>): ResolvedReviewEditor | null {
	for (const source of ["EDITOR", "VISUAL"] as const) {
		const value = env[source];
		if (typeof value !== "string") continue;
		const argv = splitEditorCommand(value);
		if (argv.length === 0) continue;
		return { source, value: value.trim(), argv };
	}
	return null;
}

function fence(content: string, language = ""): string[] {
	// Widen the fence past any run of backticks inside the payload so a skill
	// body containing ``` cannot break out of the block.
	const longest = [...content.matchAll(/`+/g)].reduce((max, match) => Math.max(max, match[0].length), 0);
	const delimiter = "`".repeat(Math.max(3, longest + 1));
	return [`${delimiter}${language}`, content.replace(/\n$/, ""), delimiter];
}

function artifactHeader(record: PendingSkillChange, now: number): string[] {
	const flags =
		record.securityFlags.length === 0
			? ["- Security flags: none"]
			: [`- Security flags (${record.securityFlags.length}, heuristic scan — not a sandbox):`, ...record.securityFlags.map((flag) => `  - ${flag}`)];
	return [
		"# Staged skill proposal",
		"",
		`**${REVIEW_ARTIFACT_WARNING}**`,
		"",
		`- Id: ${record.id}`,
		`- Action: ${record.action}`,
		`- Name: ${record.name}`,
		`- Scope: ${record.scope}${record.category ? ` (category ${record.category})` : ""}`,
		`- Gist: ${record.gist}`,
		`- Origin: tool ${record.origin.tool} · cwd ${record.origin.cwd}${record.origin.sessionId ? ` · session ${record.origin.sessionId}` : ""}`,
		`- Staged: ${record.createdAt} (${formatAge(record.createdAt, now)} ago)`,
		`- Target: ${displayPath(record.targetPath)}`,
		`- Relative target: ${record.relativeTarget}`,
		...flags,
		...(record.lastError ? [`- Last approval error: ${record.lastError}`] : []),
	];
}

/**
 * Render the artifact body for a staged record.
 *
 * - `create` / `edit` / `patch`: the proposed resulting SKILL.md, plus the
 *   record's deterministic diff when the file already exists.
 * - `write_file`: the relative target and proposed content, plus the diff when
 *   prior content exists.
 * - `remove_file` / `delete`: an explicit list of what disappears, plus the
 *   current content that would be lost.
 */
export function renderProposalArtifact(record: PendingSkillChange, now: number = Date.now()): string {
	const lines = artifactHeader(record, now);
	const pushDiff = () => {
		if (record.previousContent === null) return;
		lines.push("", "## Diff", "", ...fence(record.diff || "(no textual diff)", "diff"));
	};

	if (record.action === "create" || record.action === "edit" || record.action === "patch") {
		lines.push(
			"",
			`## Proposed resulting ${SKILL_FILE_NAME}`,
			"",
			`Full content of \`${record.relativeTarget}\` after this change is approved.`,
			"",
			...fence(record.nextContent ?? "(empty)", "markdown"),
		);
		pushDiff();
	} else if (record.action === "write_file") {
		lines.push(
			"",
			`## Proposed supporting file: ${record.relativeTarget}`,
			"",
			...fence(record.nextContent ?? "(empty)"),
		);
		pushDiff();
	} else {
		const removals =
			record.action === "delete"
				? [
						`- The entire skill directory \`${displayPath(record.skillDir)}\` and everything under it.`,
						`- The \`.agents/skills\` symlink for \`${record.name}\`, if present.`,
					]
				: [`- The file \`${record.relativeTarget}\` (\`${displayPath(record.targetPath)}\`).`];
		lines.push(
			"",
			"## Removals",
			"",
			...removals,
			"",
			"## Current content that would be lost",
			"",
			...(record.previousContent === null
				? ["(no readable current content at the target path)"]
				: fence(record.previousContent, record.relativeTarget.endsWith(".md") ? "markdown" : "")),
		);
	}

	lines.push("", "---", "", `**${REVIEW_ARTIFACT_WARNING}**`, "");
	return lines.join("\n");
}

/** Outcome of waiting on the editor child. */
export type ReviewEditorSpawnResult =
	| { kind: "exit"; code: number | null }
	| { kind: "error"; message: string };

/**
 * Process and temp-file lifecycle, injected so tests can drive every branch
 * without a terminal, a real editor, or a real temp directory.
 */
export type ReviewEditorDeps = {
	env: Record<string, string | undefined>;
	now: () => number;
	/** Create and return a fresh directory. Must not reuse an existing one. */
	makeTempDir: () => Promise<string>;
	writeArtifact: (path: string, content: string) => Promise<void>;
	/** Best-effort read-only bit; failures must not abort the review. */
	makeReadOnly: (path: string) => Promise<void>;
	removeTempDir: (path: string) => Promise<void>;
	/** Spawn argv with the terminal inherited and no shell, and wait for exit. */
	spawnEditor: (argv: string[]) => Promise<ReviewEditorSpawnResult>;
};

export function defaultReviewEditorDeps(): ReviewEditorDeps {
	return {
		env: process.env,
		now: () => Date.now(),
		makeTempDir: () => mkdtemp(join(tmpdir(), "pi-skill-review-")),
		writeArtifact: async (path, content) => {
			await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
		},
		makeReadOnly: async (path) => {
			// The containing directory stays writable so cleanup still works; only
			// the artifact loses its write bit. This is advisory — an editor can
			// still force a write, and any such write is ignored regardless.
			await chmod(path, 0o400);
		},
		removeTempDir: async (path) => {
			await rm(path, { recursive: true, force: true });
		},
		spawnEditor: (argv) =>
			new Promise<ReviewEditorSpawnResult>((resolveSpawn) => {
				const [command, ...args] = argv;
				// shell:false unconditionally. Pi's own external editor enables a
				// shell on Windows; this path deliberately does not, because the
				// editor string is attacker-influencable configuration and a shell
				// would turn `EDITOR='vim; rm -rf ~'` into two commands.
				const child = spawn(command as string, args, { stdio: "inherit", shell: false });
				child.once("error", (error: Error) => resolveSpawn({ kind: "error", message: error.message }));
				child.once("close", (code: number | null) => resolveSpawn({ kind: "exit", code }));
			}),
	};
}

/**
 * Release the terminal for a foreground child and return the restore callback.
 * The callback is idempotent, so `finally` can call it after an early restore.
 */
export function suspendTuiForForeground(tui: SkillReviewTui | undefined): () => void {
	if (!tui) return () => {};
	tui.stop();
	let restored = false;
	return () => {
		if (restored) return;
		restored = true;
		tui.start();
		tui.requestRender(true);
	};
}

/**
 * Open a staged proposal in `$EDITOR`/`$VISUAL` as a read-only report.
 *
 * Always returns normally; every failure is reported through `ctx.ui.notify`
 * so the overlay loop can reopen. The temp directory is removed in `finally`
 * on every path, and the TUI is restored on success, spawn error, nonzero
 * exit, and thrown errors alike.
 */
export async function openProposalInReviewEditor(
	selection: SkillProposalSelection,
	deps: ReviewEditorDeps = defaultReviewEditorDeps(),
): Promise<void> {
	const { record, ctx, tui } = selection;

	const editor = resolveReviewEditor(deps.env);
	if (!editor) {
		ctx.ui.notify(NO_REVIEW_EDITOR_NOTICE, "warning");
		return;
	}

	let directory: string | undefined;
	try {
		directory = await deps.makeTempDir();
		// Fixed basename inside a fresh mkdtemp directory. Proposal identity
		// belongs in file content only — never in the artifact path.
		const artifactPath = join(directory, "proposal.md");
		await deps.writeArtifact(artifactPath, renderProposalArtifact(record, deps.now()));
		await deps.makeReadOnly(artifactPath).catch(() => {});

		// Content goes in the file, never in argv and never through a shell.
		const argv = [...editor.argv, artifactPath];
		const restore = suspendTuiForForeground(tui);
		let result: ReviewEditorSpawnResult;
		try {
			result = await deps.spawnEditor(argv);
		} finally {
			restore();
		}

		if (result.kind === "error") {
			ctx.ui.notify(
				`Could not launch $${editor.source} '${editor.value}': ${result.message}. Nothing was approved; use /skills-review.`,
				"error",
			);
			return;
		}
		if (result.code !== 0) {
			ctx.ui.notify(
				`$${editor.source} '${editor.value}' exited with ${result.code === null ? "a signal" : `code ${result.code}`}. Nothing was approved; use /skills-review.`,
				"warning",
			);
			return;
		}

		ctx.ui.notify(
			`Reviewed ${record.action} ${record.name} (read-only). Approve or reject with /skills-review.`,
			"info",
		);
	} catch (error) {
		ctx.ui.notify(
			`Review failed for ${record.name}: ${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
	} finally {
		if (directory !== undefined) await deps.removeTempDir(directory).catch(() => {});
	}
}

/** Build the handler installed for the lifetime of a TUI session. */
export function createReviewEditorSelectionHandler(
	deps?: ReviewEditorDeps,
): SkillProposalSelectionHandler {
	return (selection) => openProposalInReviewEditor(selection, deps ?? defaultReviewEditorDeps());
}

// --- overlay loop ----------------------------------------------------------

/**
 * Reload the queue, open the overlay, hand off a selection, and reopen so
 * browsing continues. Reads the queue on every iteration, so records settled by
 * another session drop out on the next pass.
 */
export async function openPendingSkillsOverlay(ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) return;

	for (;;) {
		const queue = await loadSkillQueue();

		if (queue.pending.length === 0) {
			ctx.ui.notify(
				queue.skipped > 0
					? `No pending skill updates (skipped ${queue.skipped} malformed record(s) in ${displayPath(skillQueuePath())}).`
					: "No pending skill updates.",
				queue.skipped > 0 ? "warning" : "info",
			);
			return;
		}

		let stale = false;
		let controls: PendingOverlayControls | null = null;
		const unsubscribe = onSkillQueueChanged(() => {
			stale = true;
			controls?.requestRefresh();
		});

		let result: PendingOverlayResult | undefined;
		let overlayTui: SkillReviewTui | undefined;
		try {
			result = await ctx.ui.custom<PendingOverlayResult>(
				(tui, theme, _keybindings, done) => {
					// Capture the live TUI so the selection handoff can release raw
					// mode for a foreground editor and reacquire it afterwards.
					overlayTui = tui as unknown as SkillReviewTui;
					return createPendingProposalsOverlay({
						tui,
						theme,
						pending: queue.pending,
						skipped: queue.skipped,
						isStale: () => stale,
						done,
						onControls: (value) => {
							controls = value;
						},
					});
				},
				{ overlay: true, overlayOptions: { width: "80%", maxHeight: "70%", anchor: "center", margin: 1 } },
			);
		} finally {
			unsubscribe();
			controls = null;
		}

		if (!result || result.kind === "close") return;
		if (result.kind === "refresh") continue;

		// Re-read: another session may have approved or rejected this record
		// between render and selection.
		const fresh = await loadSkillQueue();
		const record = fresh.pending.find((item) => item.id === result.id);
		if (!record) {
			ctx.ui.notify(`Change ${result.id.slice(0, 8)} is already resolved; refreshing.`, "info");
			continue;
		}

		await handleSkillProposalSelection({ record, ctx, tui: overlayTui });
	}
}

async function approvalCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const mode = args.trim().toLowerCase();
	if (mode === "" || mode === "status") {
		const enabled = await isSkillApprovalEnabled();
		const depth = await pendingSkillChangeCount();
		ctx.ui.notify(`Skill write approval is ${enabled ? "on" : "off"}; ${depth} change(s) pending.`, "info");
		return;
	}
	if (mode === "on" || mode === "off") {
		await setSkillApprovalEnabled(mode === "on");
		ctx.ui.notify(
			mode === "on"
				? "Skill write approval on: every skill_manage action stages for review."
				: "Skill write approval off: unflagged actions apply immediately; security-flagged content still stages.",
			mode === "on" ? "info" : "warning",
		);
		return;
	}
	ctx.ui.notify("Usage: /skills-approval [on|off|status]", "error");
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

type ToolContext = {
	cwd: string;
	sessionId?: string;
	isProjectTrusted(): boolean;
	ui?: { notify(message: string, level: "info" | "warning" | "error"): void };
};

export function rootsForToolContext(params: SkillManageInput, ctx: ToolContext): SkillRoots {
	const scope: SkillScope = params.scope ?? "global";
	if (scope !== "global" && scope !== "project") throw new Error(`Unknown scope '${String(scope)}'.`);
	if (scope === "project" && !ctx.isProjectTrusted()) {
		throw new Error("Project scope requires a trusted project.");
	}
	return resolveSkillRoots(scope, ctx.cwd);
}

export default function skillManage(pi: ExtensionAPI) {
	let footer: SkillsReviewFooterBinding | undefined;

	pi.registerTool({
		name: "skill_manage",
		label: "Skill Manage",
		description: "Create, edit, patch, delete, and add supporting files to Pi Agent Skills.",
		promptSnippet: "Create and maintain reusable Pi Agent Skills under ~/dotfiles/skills; writes stage for user review.",
		promptGuidelines: [
			"Use skill_manage when the user asks to create, learn, edit, patch, or update a reusable Pi Agent Skill.",
			"Use write_file only for supporting files under references/, templates/, scripts/, or assets/; SKILL.md is edited with create, edit, or patch.",
			"With write approval on (default) every action stages for review; tell the user to run /skills-review (or press Alt+S) to approve.",
			"Do not use skill_manage for ordinary project files; use write or edit instead.",
		],
		parameters: SkillManageParams,
		async execute(_toolCallId, params: SkillManageInput, _signal, _onUpdate, ctx: ToolContext) {
			const roots = rootsForToolContext(params, ctx);
			const outcome = await dispatchSkillAction(roots, params, {
				sessionId: typeof ctx.sessionId === "string" ? ctx.sessionId : undefined,
				tool: "skill_manage",
				cwd: ctx.cwd,
			});

			if (outcome.staged) {
				const { record, queueDepth } = outcome;
				ctx.ui?.notify(
					record.securityFlags.length > 0
						? `Queued ${record.action} for ${record.name} with ${record.securityFlags.length} security flag(s).`
						: `Queued ${record.action} for ${record.name}.`,
					"warning",
				);

				const lines = [
					`Staged for review: ${record.gist}`,
					`Nothing was written. ${queueDepth} change(s) pending — press Alt+S or run /skills-review to approve (fallback: /skills-queue to list).`,
				];
				if (record.securityFlags.length > 0) {
					lines.push("", "Security flags (review required — this scan is a heuristic, not a sandbox):");
					for (const flag of record.securityFlags) lines.push(`  - ${flag}`);
				}

				return {
					content: [{ type: "text" as const, text: lines.join("\n") }],
					details: {
						queued: true,
						id: record.id,
						action: record.action,
						name: record.name,
						scope: record.scope,
						gist: record.gist,
						path: record.targetPath,
						relativeTarget: record.relativeTarget,
						securityFlags: record.securityFlags,
						queueDepth,
						diff: record.diff,
						reloadRequired: false,
					},
				};
			}

			const result = outcome.result;
			ctx.ui?.notify(result.message, "info");

			const lines = [result.message];
			if (result.action === "create") lines.push("Run /reload to load it in this session.");

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: {
					queued: false,
					action: result.action,
					name: result.name,
					scope: result.scope,
					path: result.targetPath,
					relativeTarget: result.relativeTarget,
					securityFlags: result.securityFlags,
					reloadRequired: result.action === "create",
				},
			};
		},
	});

	pi.registerCommand("skills-review", {
		description: "Review staged skill changes in a diff modal (a/r/s, A approve-all, R reject-all); 'browse' opens the overlay",
		handler: async (args, ctx) => {
			const mode = args.trim().toLowerCase();
			if (mode === "list") return listQueue(ctx);
			if (mode === "browse") return openPendingSkillsOverlay(ctx);
			// No-arg stays the modal approval loop: the accessible fallback when
			// Alt+S is intercepted by the terminal or another extension.
			await reviewQueue(ctx);
		},
	});

	pi.registerShortcut("alt+s", {
		description: "Browse pending skill proposals (reloads the staged queue, then opens the overlay)",
		handler: async (ctx) => openPendingSkillsOverlay(ctx),
	});

	pi.registerCommand("skills-queue", {
		description: "List staged skill changes, oldest first",
		handler: async (_args, ctx) => listQueue(ctx),
	});

	pi.registerCommand("skills-approval", {
		description: "Show or set skill write approval: /skills-approval [on|off|status]",
		handler: async (args, ctx) => approvalCommand(args, ctx),
	});

	// Footer count: startup read + queueChanged; clear on session_shutdown.
	// Cross-session staleness is accepted (documented on bindSkillsReviewFooterStatus).
	pi.on("session_start", async (_event, ctx) => {
		footer?.stop();
		footer = undefined;

		// The module-level selection handler is process-global. Install it only
		// for a UI-capable session and clear it on shutdown so a reload or an
		// RPC/print session never inherits a stale editor handoff.
		setSkillProposalSelectionHandler(null);

		if (!ctx.hasUI) return;
		setSkillProposalSelectionHandler(createReviewEditorSelectionHandler());
		footer = bindSkillsReviewFooterStatus((key, text) => ctx.ui.setStatus(key, text));
		await footer.start();
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		footer?.stop();
		footer = undefined;
		setSkillProposalSelectionHandler(null);
		if (ctx.hasUI) ctx.ui.setStatus(SKILL_MANAGE_STATUS_KEY, undefined);
	});
}
