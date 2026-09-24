#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const arguments_ = process.argv.slice(2)
const force = arguments_.includes("--force")
const root = resolve(process.cwd(), arguments_.find((argument) => !argument.startsWith("--")) ?? ".")

const copies = [
	{
		source: resolve(skillRoot, "assets/workflows/release.yml"),
		target: resolve(root, ".github/workflows/release.yml"),
	},
	{
		source: resolve(skillRoot, "assets/scripts/release"),
		target: resolve(root, ".github/scripts/release"),
	},
	{
		source: resolve(skillRoot, "assets/tests"),
		target: resolve(root, "test/release"),
	},
	{
		source: resolve(skillRoot, "assets/docs/releases.md"),
		target: resolve(root, "docs/releases.md"),
	},
]

const blocked = copies.filter((copy) => existsSync(copy.target))
if (blocked.length > 0 && !force) {
	console.error("Refusing to overwrite:")
	for (const copy of blocked) console.error(`  ${copy.target}`)
	console.error("Re-run with --force only after reviewing those files.")
	process.exit(1)
}

for (const copy of copies) {
	mkdirSync(dirname(copy.target), { recursive: true })
	cpSync(copy.source, copy.target, { recursive: true, force: true })
	console.log(`copied ${copy.target}`)
}
