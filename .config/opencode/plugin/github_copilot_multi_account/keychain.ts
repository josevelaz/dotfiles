import type { SpawnOptions } from "bun"

import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import {
	KEYCHAIN_SERVICE,
	SecretStoreCorruptError,
	SecretStoreUnavailableError,
	UnsupportedSecretStoreError,
	type SecretStore,
	type StoredCredentials,
} from "./types"
import { ensureStateDirectories, getPluginStateDir } from "./storage"

type CommandResult = {
	exitCode: number
	stdout: string
	stderr: string
}

type CommandRunner = (args: string[], options?: SpawnOptions.OptionsObject<string>) => Promise<CommandResult>

type SecretStoreOptions = {
	runner?: CommandRunner
	platform?: NodeJS.Platform
	baseDir?: string
}

type SecretMetadata = {
	versions: number[]
}

export function getKeychainAccountName(ref: string, version: number): string {
	return `${ref}:v${version}`
}

function normalizeVersions(versions: number[]): number[] {
	return [...new Set(versions.filter((value) => Number.isInteger(value) && value > 0))].sort((left, right) => left - right)
}

function getSecretMetadataDir(baseDir?: string): string {
	return path.join(getPluginStateDir(baseDir), "secret-metadata")
}

function getSecretMetadataPath(ref: string, baseDir?: string): string {
	return path.join(getSecretMetadataDir(baseDir), `${ref}.json`)
}

async function readSecretMetadata(ref: string, baseDir?: string): Promise<SecretMetadata> {
	try {
		const raw = await readFile(getSecretMetadataPath(ref, baseDir), "utf8")
		const parsed = JSON.parse(raw) as Partial<SecretMetadata>
		return { versions: normalizeVersions(parsed.versions ?? []) }
	} catch {
		return { versions: [] }
	}
}

async function writeSecretMetadata(ref: string, metadata: SecretMetadata, baseDir?: string): Promise<void> {
	await ensureStateDirectories(baseDir)
	const metadataDir = getSecretMetadataDir(baseDir)
	await mkdir(metadataDir, { recursive: true, mode: 0o700 })
	await chmod(metadataDir, 0o700)
	const filePath = getSecretMetadataPath(ref, baseDir)
	await writeFile(filePath, `${JSON.stringify({ versions: normalizeVersions(metadata.versions) }, null, 2)}\n`, { mode: 0o600 })
	await chmod(filePath, 0o600)
}

function mapSecurityError(error: CommandResult): Error {
	const message = `${error.stderr}\n${error.stdout}`.toLowerCase()
	if (message.includes("could not be found") || message.includes("item not found")) {
		return new SecretStoreCorruptError()
	}
	if (message.includes("user interaction is not allowed") || message.includes("interaction is not allowed")) {
		return new SecretStoreUnavailableError()
	}
	return new SecretStoreUnavailableError(error.stderr || error.stdout || "security command failed")
}

async function defaultRunner(args: string[], options?: SpawnOptions.OptionsObject<string>): Promise<CommandResult> {
	const proc = Bun.spawn({
		cmd: ["security", ...args],
		stdout: "pipe",
		stderr: "pipe",
		...(options ?? {}),
	})
	const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited])
	return { exitCode, stdout, stderr }
}

function ensureSupportedPlatform(platform: NodeJS.Platform) {
	if (platform !== "darwin") throw new UnsupportedSecretStoreError()
}

export function createSecretStore(options: SecretStoreOptions = {}): SecretStore {
	const platform = options.platform ?? process.platform
	const runner = options.runner ?? defaultRunner
	const baseDir = options.baseDir

	ensureSupportedPlatform(platform)

	return {
		async upsert(ref, version, value) {
			const account = getKeychainAccountName(ref, version)
			const payload = JSON.stringify(value)
			const result = await runner(["add-generic-password", "-U", "-a", account, "-s", KEYCHAIN_SERVICE, "-w", payload])
			if (result.exitCode !== 0) throw mapSecurityError(result)
			const metadata = await readSecretMetadata(ref, baseDir)
			metadata.versions.push(version)
			await writeSecretMetadata(ref, metadata, baseDir)
		},
		async read(ref, version) {
			const account = getKeychainAccountName(ref, version)
			const result = await runner(["find-generic-password", "-a", account, "-s", KEYCHAIN_SERVICE, "-w"])
			if (result.exitCode !== 0) throw mapSecurityError(result)
			try {
				return JSON.parse(result.stdout) as StoredCredentials
			} catch {
				throw new SecretStoreCorruptError()
			}
		},
		async listVersions(ref) {
			const metadata = await readSecretMetadata(ref, baseDir)
			return metadata.versions
		},
		async removeVersion(ref, version) {
			const account = getKeychainAccountName(ref, version)
			const result = await runner(["delete-generic-password", "-a", account, "-s", KEYCHAIN_SERVICE])
			if (result.exitCode !== 0 && !result.stderr.toLowerCase().includes("could not be found")) {
				throw mapSecurityError(result)
			}
			const metadata = await readSecretMetadata(ref, baseDir)
			metadata.versions = metadata.versions.filter((entry) => entry !== version)
			if (metadata.versions.length === 0) {
				await rm(getSecretMetadataPath(ref, baseDir), { force: true })
				return
			}
			await writeSecretMetadata(ref, metadata, baseDir)
		},
		async removeAll(ref) {
			const versions = await this.listVersions(ref)
			for (const version of versions) {
				await this.removeVersion(ref, version)
			}
			await rm(getSecretMetadataPath(ref, baseDir), { force: true })
		},
	}
}
