import { Plugin } from "@opencode/plugin"

const MODEL = "opencode/jev-1.13-free"
const PROVIDER = "opencode"
const MODEL_ID = "jev-1.13-free"

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

type ChoiceValue = string | boolean

type NormalizedQuestion =
  | {
      type: "predicate"
      name: string
      instructions: string
      criteria?: { true?: string; false?: string }
    }
  | {
      type: "choice"
      name: string
      instructions: string
      choices: Array<{ value: ChoiceValue; description?: string }>
    }
  | {
      type: "score"
      name: string
      instructions: string
      levels: Array<{ label: string; description?: string }>
    }

type DecisionAnswer =
  | { type: "predicate"; name: string; probability: number }
  | {
      type: "choice"
      name: string
      choice: ChoiceValue
      confidence: number
      probabilities: Array<{ value: ChoiceValue; probability: number }>
    }
  | {
      type: "score"
      name: string
      score: number
      confidence: number
      probabilities: Array<{ value: number; label: string; probability: number }>
    }
  | { type: "error"; name: string; reason: string; message?: string }

type Answer =
  | { type: "predicate"; name: string; value: boolean; probability: number }
  | {
      type: "choice"
      name: string
      choice: ChoiceValue
      confidence: number
      probabilities: Array<{ value: ChoiceValue; probability: number }>
    }
  | {
      type: "score"
      name: string
      score: number
      confidence: number
      probabilities: Array<{ value: number; label: string; probability: number }>
    }
  | { type: "error"; name: string; reason: string; message?: string }

const choiceValueSchema: Record<string, unknown> = {
  anyOf: [{ type: "string" }, { type: "boolean" }],
}

const answerSchema: Record<string, unknown> = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "name", "value", "probability"],
      properties: {
        type: { const: "predicate" },
        name: { type: "string" },
        value: { type: "boolean" },
        probability: { type: "number" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "name", "choice", "confidence", "probabilities"],
      properties: {
        type: { const: "choice" },
        name: { type: "string" },
        choice: choiceValueSchema,
        confidence: { type: "number" },
        probabilities: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["value", "probability"],
            properties: {
              value: choiceValueSchema,
              probability: { type: "number" },
            },
          },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "name", "score", "confidence", "probabilities"],
      properties: {
        type: { const: "score" },
        name: { type: "string" },
        score: { type: "number" },
        confidence: { type: "number" },
        probabilities: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["value", "label", "probability"],
            properties: {
              value: { type: "number" },
              label: { type: "string" },
              probability: { type: "number" },
            },
          },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "name", "reason"],
      properties: {
        type: { const: "error" },
        name: { type: "string" },
        reason: { type: "string" },
        message: { type: "string" },
      },
    },
  ],
}

const inputSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["input", "questions"],
  properties: {
    input: {
      anyOf: [
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "object" },
        { type: "array" },
      ],
    },
    questions: {
      type: "array",
      minItems: 1,
      items: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "name", "instructions"],
            properties: {
              type: { const: "predicate" },
              name: { type: "string" },
              instructions: { type: "string" },
              criteria: {
                type: "object",
                additionalProperties: false,
                properties: {
                  true: { type: "string" },
                  false: { type: "string" },
                },
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "name", "instructions", "choices"],
            properties: {
              type: { const: "choice" },
              name: { type: "string" },
              instructions: { type: "string" },
              choices: {
                type: "array",
                minItems: 2,
                items: {
                  anyOf: [
                    { type: "string" },
                    { type: "boolean" },
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["value"],
                      properties: {
                        value: choiceValueSchema,
                        description: { type: "string" },
                      },
                    },
                  ],
                },
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "name", "instructions", "levels"],
            properties: {
              type: { const: "score" },
              name: { type: "string" },
              instructions: { type: "string" },
              levels: {
                type: "array",
                minItems: 2,
                items: {
                  anyOf: [
                    { type: "string" },
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["label"],
                      properties: {
                        label: { type: "string" },
                        description: { type: "string" },
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  },
}

const outputSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["model", "answers", "results"],
  properties: {
    model: { type: "string", const: MODEL },
    answers: { type: "array", items: answerSchema },
    results: { type: "object", additionalProperties: answerSchema },
  },
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function normalizeInput(value: unknown): { type: "text"; text: string } | { type: "json"; value: JsonValue } {
  if (value === undefined || value === null) throw new Error("input is required")
  if (typeof value === "string") return { type: "text", text: value }
  return { type: "json", value: value as JsonValue }
}

function normalizeCriteria(value: unknown, label: string): { true?: string; false?: string } | undefined {
  if (value === undefined) return undefined
  const record = asObject(value, label)
  const criteria: { true?: string; false?: string } = {}
  if (record.true !== undefined) {
    if (typeof record.true !== "string") throw new Error(`${label}.true must be a string`)
    criteria.true = record.true
  }
  if (record.false !== undefined) {
    if (typeof record.false !== "string") throw new Error(`${label}.false must be a string`)
    criteria.false = record.false
  }
  return criteria
}

function normalizeChoiceItem(value: unknown, label: string): { value: ChoiceValue; description?: string } {
  if (typeof value === "string" || typeof value === "boolean") return { value }
  const record = asObject(value, label)
  const choice = record.value
  if (typeof choice !== "string" && typeof choice !== "boolean") {
    throw new Error(`${label}.value must be a string or boolean`)
  }
  if (record.description !== undefined && typeof record.description !== "string") {
    throw new Error(`${label}.description must be a string`)
  }
  return record.description === undefined
    ? { value: choice }
    : { value: choice, description: record.description }
}

function normalizeLevel(value: unknown, label: string): { label: string; description?: string } {
  if (typeof value === "string") return { label: readString(value, label) }
  const record = asObject(value, label)
  const labelValue = readString(record.label, `${label}.label`)
  if (record.description !== undefined && typeof record.description !== "string") {
    throw new Error(`${label}.description must be a string`)
  }
  return record.description === undefined
    ? { label: labelValue }
    : { label: labelValue, description: record.description }
}

function normalizeQuestion(value: unknown, index: number): NormalizedQuestion {
  const label = `questions[${index}]`
  const record = asObject(value, label)
  const name = readString(record.name, `${label}.name`)
  const instructions = readString(record.instructions, `${label}.instructions`)
  const type = record.type

  if (type === "predicate") {
    const criteria = normalizeCriteria(record.criteria, `${label}.criteria`)
    return criteria
      ? { type: "predicate", name, instructions, criteria }
      : { type: "predicate", name, instructions }
  }

  if (type === "choice") {
    if (!Array.isArray(record.choices) || record.choices.length < 2) {
      throw new Error(`${label}.choices must contain at least two items`)
    }
    return {
      type: "choice",
      name,
      instructions,
      choices: record.choices.map((item, itemIndex) => normalizeChoiceItem(item, `${label}.choices[${itemIndex}]`)),
    }
  }

  if (type === "score") {
    if (!Array.isArray(record.levels) || record.levels.length < 2) {
      throw new Error(`${label}.levels must contain at least two items`)
    }
    return {
      type: "score",
      name,
      instructions,
      levels: record.levels.map((item, itemIndex) => normalizeLevel(item, `${label}.levels[${itemIndex}]`)),
    }
  }

  throw new Error(`${label}.type must be "predicate", "choice", or "score"`)
}

function normalizeQuestions(value: unknown): NormalizedQuestion[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("questions must be a non-empty array")
  }
  const questions = value.map((question, index) => normalizeQuestion(question, index))
  const names = new Set<string>()
  for (const question of questions) {
    if (names.has(question.name)) throw new Error(`question name "${question.name}" must be unique`)
    names.add(question.name)
  }
  return questions
}

function toAnswer(answer: DecisionAnswer): Answer {
  if (answer.type === "predicate") {
    return {
      type: "predicate",
      name: answer.name,
      value: answer.probability >= 0.5,
      probability: answer.probability,
    }
  }
  if (answer.type === "choice") {
    return {
      type: "choice",
      name: answer.name,
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities: answer.probabilities.map((entry) => ({ value: entry.value, probability: entry.probability })),
    }
  }
  if (answer.type === "score") {
    return {
      type: "score",
      name: answer.name,
      score: answer.score,
      confidence: answer.confidence,
      probabilities: answer.probabilities.map((entry) => ({
        value: entry.value,
        label: entry.label,
        probability: entry.probability,
      })),
    }
  }
  return answer.message === undefined
    ? { type: "error", name: answer.name, reason: answer.reason }
    : { type: "error", name: answer.name, reason: answer.reason, message: answer.message }
}

export default Plugin.define({
  id: "local.classify",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "classify",
        description:
          "Classify text or JSON data with OpenCode's free Jev 1.13 decision model (opencode/jev-1.13-free). Evaluates multiple predicate (yes/no), choice (one of a set), and score (ordered rubric) questions in parallel in one call. Returns typed answers with calibrated probabilities as an ordered answers array and a results object keyed by question name.",
        options: { codemode: { pinned: true } },
        input: inputSchema,
        output: outputSchema,
        async execute(raw, context) {
          const args = asObject(raw, "classify input")
          if (!("input" in args)) throw new Error("input is required")
          const input = normalizeInput(args.input)
          const questions = normalizeQuestions(args.questions)

          const response = await ctx.experimental.generate.decisions(
            {
              model: { providerID: PROVIDER, id: MODEL_ID },
              input: [input],
              questions,
            },
            { signal: context.signal },
          )

          const answers = response.answers.map(toAnswer)
          const output = {
            model: MODEL,
            answers,
            results: Object.fromEntries(answers.map((answer) => [answer.name, answer])),
          }

          return {
            output,
            content: JSON.stringify(output),
            metadata: { model: MODEL, questionCount: questions.length },
          }
        },
      })
    })
  },
})
