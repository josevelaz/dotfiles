import { readFile } from "node:fs/promises"
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
 * Returns undefined when idle (missing guide, guide-self target, or
 * un-applicable input). Never throws for tool-input conditions.
 */
export async function loadBucklerState(args: BucklerLoadArgs): Promise<BucklerState | undefined> {
  try {
    const { sessionDirectory, projectCanonical, guideOption, tool, input } = args
    if (tool !== "write" && tool !== "edit") return undefined
    if (typeof sessionDirectory !== "string" || sessionDirectory === "") return undefined

    let guidePath: string | undefined
    let styleGuide: string | undefined
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

    if (typeof input !== "object" || input === null) return undefined
    const record = input as Record<string, unknown>
    const rawPath = record["path"] ?? record["filePath"]
    if (typeof rawPath !== "string" || rawPath.length === 0) return undefined
    const targetPath = resolveAgainst(sessionDirectory, rawPath)
    if (targetPath === guidePath) return undefined

    if (tool === "write") {
      const content = record["content"]
      if (typeof content !== "string") return undefined
      return { style_guide: styleGuide, path: targetPath, tool: "write", proposed_content: content }
    }

    const oldString = record["oldString"]
    const newString = record["newString"]
    if (typeof oldString !== "string" || typeof newString !== "string") return undefined
    if (oldString === "") return undefined
    let existing: string
    try {
      existing = await readFile(targetPath, "utf8")
    } catch {
      return undefined
    }
    const matches = existing.split(oldString).length - 1
    if (matches === 0) return undefined
    if (matches > 1 && record["replaceAll"] !== true) return undefined
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
  } catch {
    return undefined
  }
}
