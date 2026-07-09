import type { Dirent } from "node:fs"
import { access, lstat, open, readdir, stat } from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"

interface SkillInfo {
	name: string
	description?: string
	source: string
}

interface OpencodeCommand {
	description?: string
	template: string
}

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const FRONTMATTER_READ_LIMIT_BYTES = 64 * 1024

const globalConfigDir = path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "opencode")

function uniquePaths(paths: string[]): string[] {
	const seen = new Set<string>()
	const result: string[] = []

	for (const candidate of paths) {
		const normalized = path.resolve(candidate)
		if (seen.has(normalized)) continue
		seen.add(normalized)
		result.push(normalized)
	}

	return result
}

function expandHome(input: string): string {
	if (input === "~") return os.homedir()
	if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2))
	return input
}

function resolveConfiguredPath(configPath: string, projectRoot: string): string {
	const expanded = expandHome(configPath)
	if (path.isAbsolute(expanded)) return expanded
	return path.resolve(projectRoot, expanded)
}

async function pathExists(candidate: string): Promise<boolean> {
	try {
		await access(candidate)
		return true
	} catch {
		return false
	}
}

async function isDirectoryEntry(entryPath: string, entry: { isDirectory(): boolean; isSymbolicLink(): boolean }): Promise<boolean> {
	if (entry.isDirectory()) return true
	if (!entry.isSymbolicLink()) return false

	try {
		return (await stat(entryPath)).isDirectory()
	} catch {
		return false
	}
}

function extractFrontmatter(markdown: string): Record<string, string> {
	if (!markdown.startsWith("---\n")) return {}

	const end = markdown.indexOf("\n---", 4)
	if (end === -1) return {}

	const fields: Record<string, string> = {}
	const frontmatter = markdown.slice(4, end).split("\n")

	for (const line of frontmatter) {
		const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
		if (!match) continue

		const [, key, rawValue] = match
		const value = rawValue.trim().replace(/^['"]|['"]$/g, "")
		fields[key] = value
	}

	return fields
}

async function readSkill(skillFile: string): Promise<SkillInfo | undefined> {
	let fileHandle: Awaited<ReturnType<typeof open>> | undefined

	try {
		const fileStat = await lstat(skillFile)
		if (!fileStat.isFile()) return undefined

		fileHandle = await open(skillFile, "r")
		const buffer = Buffer.alloc(FRONTMATTER_READ_LIMIT_BYTES)
		const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, 0)
		const content = buffer.subarray(0, bytesRead).toString("utf8")
		const frontmatter = extractFrontmatter(content)
		const dirname = path.basename(path.dirname(skillFile))
		const name = frontmatter.name || dirname

		if (!SKILL_NAME_PATTERN.test(name)) return undefined

		return {
			name,
			description: frontmatter.description,
			source: skillFile,
		}
	} catch {
		return undefined
	} finally {
		await fileHandle?.close()
	}
}

async function findSkillFiles(root: string): Promise<string[]> {
	if (!(await pathExists(root))) return []

	const found: string[] = []
	let entries: Dirent[]

	try {
		entries = await readdir(root, { withFileTypes: true })
	} catch {
		return []
	}

	for (const entry of entries) {
		const entryPath = path.join(root, entry.name)
		if (!(await isDirectoryEntry(entryPath, entry))) continue

		const skillFile = path.join(entryPath, "SKILL.md")
		if (await pathExists(skillFile)) {
			found.push(skillFile)
		}
	}

	return found
}

function configuredSkillPaths(cfg: Record<string, unknown>, projectRoot: string): string[] {
	const skills = cfg.skills
	if (!skills || typeof skills !== "object") return []

	const paths = (skills as { paths?: unknown }).paths
	if (!Array.isArray(paths)) return []

	return paths
		.filter((value): value is string => typeof value === "string")
		.map((value) => resolveConfiguredPath(value, projectRoot))
}

function defaultSkillRoots(projectRoot: string): string[] {
	return uniquePaths([
		path.join(projectRoot, ".opencode/skills"),
		path.join(projectRoot, ".opencode/skill"),
		path.join(projectRoot, ".agents/skills"),
		path.join(projectRoot, ".claude/skills"),
		path.join(globalConfigDir, "skills"),
		path.join(globalConfigDir, "skill"),
		path.join(globalConfigDir, ".agents/skills"),
		path.join(os.homedir(), ".agents/skills"),
		path.join(os.homedir(), ".claude/skills"),
	])
}

async function discoverSkills(cfg: Record<string, unknown>, projectRoot: string): Promise<SkillInfo[]> {
	const roots = uniquePaths([...defaultSkillRoots(projectRoot), ...configuredSkillPaths(cfg, projectRoot)])
	const byName = new Map<string, SkillInfo>()

	for (const root of roots) {
		for (const skillFile of await findSkillFiles(root)) {
			const skill = await readSkill(skillFile)
			if (!skill) continue

			byName.set(skill.name, skill)
		}
	}

	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function buildSkillCommand(skill: SkillInfo): OpencodeCommand {
	return {
		description: `Load and apply the ${skill.name} skill.`,
		template: `Load the opencode skill named \`${skill.name}\` and use it for this request.

User request:
$ARGUMENTS

Workflow:
1. Call the \`skill\` tool with \`name: "${skill.name}"\`.
2. Follow the loaded skill's instructions for the user request above.
3. If the skill is unavailable, explain that opencode may need to be restarted or the skill is not currently loaded.`,
	}
}

function buildGenericSkillCommand(): OpencodeCommand {
	return {
		description: "Load and apply a skill by name.",
		template: `Load the opencode skill named \`$1\` and use it for this request.

User request:
$ARGUMENTS

Workflow:
1. Treat the first argument as the skill name.
2. Call the \`skill\` tool with that skill name.
3. Follow the loaded skill's instructions for the remaining user request.
4. If the skill is unavailable, explain that opencode may need to be restarted or the skill is not currently loaded.`,
	}
}

const SkillCommandsPlugin: Plugin = async ({ directory }) => {
	return {
		config: async (cfg: Record<string, unknown>) => {
			const commands = (cfg.command && typeof cfg.command === "object" ? cfg.command : {}) as Record<string, OpencodeCommand>
			const skills = await discoverSkills(cfg, directory)

			if (!commands.skill) {
				commands.skill = buildGenericSkillCommand()
			}

			for (const skill of skills) {
				const commandName = `skill:${skill.name}`
				if (commands[commandName]) continue

				commands[commandName] = buildSkillCommand(skill)
			}

			cfg.command = commands
		},
	}
}

export default SkillCommandsPlugin
