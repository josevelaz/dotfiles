import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"

export async function readFixture(filePath: string): Promise<string> {
	return readFile(filePath, "utf8")
}

export function hashFixture(text: string): string {
	return createHash("sha256").update(text).digest("hex")
}
