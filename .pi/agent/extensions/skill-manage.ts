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

import { withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	access,
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

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

type ToolContext = {
	cwd: string;
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
	pi.registerTool({
		name: "skill_manage",
		label: "Skill Manage",
		description: "Create, edit, patch, delete, and add supporting files to Pi Agent Skills.",
		promptSnippet: "Create and maintain reusable Pi Agent Skills under ~/dotfiles/skills.",
		promptGuidelines: [
			"Use skill_manage when the user asks to create, learn, edit, patch, or update a reusable Pi Agent Skill.",
			"Use write_file only for supporting files under references/, templates/, scripts/, or assets/; SKILL.md is edited with create, edit, or patch.",
			"Do not use skill_manage for ordinary project files; use write or edit instead.",
		],
		parameters: SkillManageParams,
		async execute(_toolCallId, params: SkillManageInput, _signal, _onUpdate, ctx: ToolContext) {
			const roots = rootsForToolContext(params, ctx);
			const result = await executeSkillAction(roots, params);

			if (result.securityFlags.length > 0) {
				ctx.ui?.notify(`skill_manage: ${result.securityFlags.length} security flag(s) on ${result.name}`, "warning");
			} else {
				ctx.ui?.notify(result.message, "info");
			}

			const lines = [result.message];
			if (result.securityFlags.length > 0) {
				lines.push("", "Security flags (review required — this scan is a heuristic, not a sandbox):");
				for (const flag of result.securityFlags) lines.push(`  - ${flag}`);
			}
			if (result.action === "create") lines.push("Run /reload to load it in this session.");

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: {
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
}
