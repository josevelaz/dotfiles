import { APITimeoutError, TypeSafeClient, choice, noul } from "@typesafe-ai/sdk"
import type { EntryType, Questions } from "@typesafe-ai/sdk"
import { parseGuideHeadings } from "./loader"
import type { BucklerState } from "./loader"

const MODEL = "jev-latest"
/** Conservative char budget for the Jev 32k-token state budget (~3 chars per token). */
const STATE_CHAR_BUDGET = 32_000 * 3

function apiKeyMissing(): boolean {
  const raw = process.env.TYPESAFE_API_KEY
  return typeof raw !== "string" || raw.trim() === ""
}

function apiKeyError(): Error {
  return new Error(
    "buckler: API-key failure: TYPESAFE_API_KEY is missing or blank. Set it to enable style gating.",
  )
}

function oversizedError(size: number): Error {
  return new Error(
    `buckler: oversized state: snapshot plus questions are ${size} chars, over the Jev state budget of ${STATE_CHAR_BUDGET}. Reduce the guide or change size.`,
  )
}

function malformedError(detail: string): Error {
  return new Error(`buckler: malformed answers: Jev returned an unexpected answer shape (${detail}).`)
}

function timeoutError(detail: string): Error {
  return new Error(`buckler: timeout: Jev evaluation timed out (${detail}).`)
}

function apiError(detail: string): Error {
  return new Error(`buckler: API failure: Jev evaluation failed (${detail}).`)
}

function isTimeout(err: unknown): boolean {
  if (err instanceof APITimeoutError) return true
  if (typeof err === "object" && err !== null) {
    const name = (err as { name?: unknown }).name
    if (typeof name === "string" && name.toLowerCase().includes("timeout")) return true
  }
  const message = err instanceof Error ? err.message : String(err)
  return /\btimed?\s*out\b/i.test(message)
}

function mapCallError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err)
  if (isTimeout(err)) return timeoutError(message)
  return apiError(message)
}

function buildNoulQuestions(headings: string[]): Questions {
  const questions: Questions = {}
  headings.forEach((heading, index) => {
    const title = heading.trim() === "" ? `section ${index + 1}` : heading
    questions[`section_${index}`] = noul(
      `Does \`proposed_content\` satisfy the \`style_guide\` section titled "${title}"? Answer yes only when it satisfies that section.`,
      {
        true: `The \`proposed_content\` meets the \`style_guide\` section "${title}".`,
        false: `The \`proposed_content\` violates the \`style_guide\` section "${title}".`,
      },
    )
  })
  return questions
}

function buildChoiceQuestion(): Questions {
  return {
    decision: choice(
      "Does `proposed_content` satisfy the whole `style_guide`? Accept when it complies; reject when it violates any part of the guide.",
      {
        accept: "The `proposed_content` complies with the `style_guide`.",
        reject: "The `proposed_content` violates the `style_guide`.",
      },
    ),
  }
}

/**
 * Gate a loaded snapshot through TypeSafe Jev. Resolves when Jev accepts;
 * throws when Jev rejects or the evaluation fails. Never logs state,
 * answers, file bodies, or the API key.
 */
export async function gateBucklerState(state: BucklerState): Promise<void> {
  if (apiKeyMissing()) throw apiKeyError()

  const headings = parseGuideHeadings(state.style_guide)
  const useNoul = headings.length > 0
  const questions = useNoul ? buildNoulQuestions(headings) : buildChoiceQuestion()

  const payload: Record<string, unknown> = {
    style_guide: state.style_guide,
    path: state.path,
    tool: state.tool,
    proposed_content: state.proposed_content,
  }
  if (state.existing_content !== undefined) payload["existing_content"] = state.existing_content
  if (state.change !== undefined) {
    payload["change"] = { oldString: state.change.oldString, newString: state.change.newString }
  }

  const serializedSize =
    (JSON.stringify(payload) ?? "").length + (JSON.stringify(questions) ?? "").length
  if (serializedSize > STATE_CHAR_BUDGET) throw oversizedError(serializedSize)

  let client: TypeSafeClient
  try {
    client = new TypeSafeClient({ logLevel: "warn" })
  } catch (err) {
    if (apiKeyMissing()) throw apiKeyError()
    throw mapCallError(err)
  }

  let result: unknown
  try {
    result = await client.systemOne({
      state: payload as EntryType,
      questions,
      model: MODEL,
    })
  } catch (err) {
    throw mapCallError(err)
  }

  const answers =
    typeof result === "object" && result !== null
      ? (result as { answers?: unknown }).answers
      : undefined
  if (typeof answers !== "object" || answers === null) {
    throw malformedError("missing answers object")
  }
  const record = answers as Record<string, unknown>

  if (useNoul) {
    const failed: Array<{ title: string; noul: number }> = []
    headings.forEach((heading, index) => {
      const id = `section_${index}`
      const answer = record[id]
      const value =
        typeof answer === "object" && answer !== null
          ? (answer as { noul?: unknown }).noul
          : undefined
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw malformedError(`question "${id}" is missing a numeric noul`)
      }
      if (value < 0.5) {
        failed.push({ title: heading.trim() === "" ? `section ${index + 1}` : heading, noul: value })
      }
    })
    if (failed.length > 0) {
      const titles = failed.map((entry) => `"${entry.title}"`).join(", ")
      throw new Error(
        `buckler: style reject: \`proposed_content\` violates \`style_guide\` section(s): ${titles}. Revise the change to satisfy the guide and retry.`,
      )
    }
    return
  }

  const answer = record["decision"]
  const selected =
    typeof answer === "object" && answer !== null
      ? (answer as { choice?: unknown }).choice
      : undefined
  const confidence =
    typeof answer === "object" && answer !== null
      ? (answer as { confidence?: unknown }).confidence
      : undefined
  if ((selected !== "accept" && selected !== "reject") || typeof confidence !== "number" || !Number.isFinite(confidence)) {
    throw malformedError('question "decision" is missing an accept/reject choice with numeric confidence')
  }
  if (selected === "reject") {
    throw new Error(
      `buckler: style reject: \`proposed_content\` rejected under the \`style_guide\` (choice=reject, confidence=${confidence}). Revise the change to satisfy the guide and retry.`,
    )
  }
}
