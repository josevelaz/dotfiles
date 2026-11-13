// Routing policy for `claude-agent/auto`, derived from "Which Claude model should
// you build with?" (claude.dev, Nov 2026). Jev answers the semantic questions;
// this module owns every rule that turns those answers into a model and effort.

export type ClaudeModel = "haiku" | "sonnet" | "opus" | "fable"
export type Effort = "low" | "medium" | "high" | "xhigh"
export type Route = { readonly model: ClaudeModel; readonly effort: Effort }

// The article's escalation order: raise effort one level, and past `high` move
// to the next model up at a lower effort. Fable has no generally available model
// above it, so its last step is `xhigh`, reached only after a shortfall at `high`.
const LADDER: readonly Route[] = [
  { model: "haiku", effort: "medium" },
  { model: "haiku", effort: "high" },
  { model: "sonnet", effort: "low" },
  { model: "sonnet", effort: "medium" },
  { model: "sonnet", effort: "high" },
  { model: "opus", effort: "medium" },
  { model: "opus", effort: "high" },
  { model: "fable", effort: "medium" },
  { model: "fable", effort: "high" },
  { model: "fable", effort: "xhigh" },
]

const rung = (model: ClaudeModel, effort: Effort): number =>
  LADDER.findIndex((r) => r.model === model && r.effort === effort)

const FABLE_MEDIUM = rung("fable", "medium")
const FABLE_HIGH = rung("fable", "high")
const OPUS_HIGH = rung("opus", "high")

// Fable is rationed. Artificial Analysis (Intelligence Index v5, Nov 2026; score, cost and
// minutes per task): Opus high 52 / $3.46 / 9.5, Fable medium 56 / $3.80 / 8.1,
// Fable high 62 / $9.08 / 17.5, Fable xhigh 62 / $14.83 / 26.1. Fable at `medium` costs about
// what Opus `high` does; above `medium` its cost and time more than double. So:
// - a Fable category must win clearly, else the turn is treated as everyday engineering;
// - Fable `high` needs a confident "hardest"; `xhigh` is reached only after a shortfall.
const MIN_FABLE_PROBABILITY = 0.8
// Difficulty escalates a route only when Jev puts at least this much probability on it.
const MIN_ESCALATION_PROBABILITY = 0.6

// Implementation work that adds or changes UI or UX runs on at least Opus `high`.
const UI_ROUTE = OPUS_HIGH

// "You aren't sure yet": Opus 5.5 at its default `medium`.
export const DEFAULT_ROUTE: Route = { model: "opus", effort: "medium" }
export const TITLE_ROUTE: Route = { model: "haiku", effort: "low" }
export const GENERATE_ROUTE: Route = { model: "sonnet", effort: "medium" }

// One row per line of the article's "Pick a model by task" table.
const CATEGORIES = {
  everyday_engineering: {
    start: rung("opus", "medium"),
    description:
      "Everyday engineering and debugging, open-ended investigation of a codebase, or multi-PR feature work that needs judgment.",
  },
  classification_extraction: {
    start: rung("haiku", "medium"),
    description: "Classification, routing, tagging, or high-volume extraction with checkable outputs.",
  },
  side_task: {
    start: rung("haiku", "medium"),
    description:
      "A side task for a larger agent: searching files, reading logs or test output, or summarizing. Wrong answers are cheap to spot.",
  },
  chat: {
    start: rung("sonnet", "low"),
    description: "Conversational chat or a quick question that needs a fast reply rather than work on files.",
  },
  scoped_coding: {
    start: rung("sonnet", "medium"),
    description:
      "Well-scoped coding: a specific bug fix, feature iteration against a clear spec, a ticket with acceptance criteria, or a small known change to code, prompts, or configuration.",
  },
  documents: {
    start: rung("sonnet", "medium"),
    description: "Everyday documents, slides, spreadsheets, or prose writing.",
  },
  repeated_agent_task: {
    start: rung("sonnet", "medium"),
    description: "A well-defined agent task of a kind run repeatedly, such as a code review, an investigation report, or a draft.",
  },
  computer_use_vision: {
    start: rung("opus", "medium"),
    description: "Computer use, browser driving, or vision-heavy work over many screenshots or images.",
  },
  major_refactor_architecture: {
    start: rung("fable", "medium"),
    description:
      "A major refactor or migration that spans a large part of a codebase, system-level architecture planning, or leading many subagents through a large multi-part project. Not a change to a few files, a prompt, or configuration, even when the request mentions agents, subagents, routing, or architecture.",
  },
  deep_research: {
    start: rung("fable", "medium"),
    description:
      "Deep multi-source research, or scientific, financial, or quantitative analysis at the hardest level. Not looking up a few facts or reading documentation for a coding task.",
  },
  unsure: {
    start: rung("opus", "medium"),
    description: "None of the above clearly fits, or the request is too vague to tell.",
  },
} as const

export type Category = keyof typeof CATEGORIES

const DIFFICULTY = [
  { label: "routine", description: "Straightforward for its kind; a capable model should get it right first time." },
  {
    label: "demanding",
    description: "Harder than usual for its kind: subtle bugs, several interacting parts, or the model must check its own work carefully.",
  },
  {
    label: "hardest",
    description:
      "Among the hardest work of its kind: e.g. a performance optimization, a migration, a long unattended run, or a problem that has resisted earlier attempts.",
  },
] as const

// Inputs and outputs use the shape of OpenCode's generate.decisions endpoint.
export type RoutingState = {
  agent: { name: string; mode: string; description?: string }
  latest_user_message: string
  previous_user_message?: string
  attachments: string[]
  previous_route?: string
}

export type DecisionQuestion =
  | { type: "predicate"; name: string; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: "choice"; name: string; instructions: string; choices: { value: string; description?: string }[] }
  | { type: "score"; name: string; instructions: string; levels: { label: string; description?: string }[] }

export type DecisionAnswer =
  | { type: "predicate"; name: string; probability: number }
  | {
      type: "choice"
      name: string
      choice: string | boolean
      probabilities: readonly { value: string | boolean; probability: number }[]
      confidence: number
    }
  | {
      type: "score"
      name: string
      score: number
      probabilities: readonly { value: number; label: string; probability: number }[]
      confidence: number
    }
  | { type: "error"; name: string; reason: string; message?: string }

export function buildQuestions(state: RoutingState): DecisionQuestion[] {
  const questions: DecisionQuestion[] = [
    {
      type: "choice",
      name: "category",
      instructions:
        "An AI coding agent is about to work on `latest_user_message`, sent to the agent described in `agent` (mode `subagent` means a larger agent delegated it). `attachments` lists attached file types. Which kind of work is it?",
      choices: Object.entries(CATEGORIES).map(([value, c]) => ({ value, description: c.description })),
    },
    {
      type: "score",
      name: "difficulty",
      instructions: "How hard is the work in `latest_user_message` compared with typical work of the same kind?",
      levels: DIFFICULTY.map((d) => ({ label: d.label, description: d.description })),
    },
    {
      type: "predicate",
      name: "shortfall",
      instructions:
        "Does `latest_user_message` complain that the agent's own earlier attempt at this task failed, fell short, or was wrong, or ask it to try again harder or more thoroughly?",
      criteria: {
        true: "The user reports that the agent's previous answer or fix did not work, e.g. 'that didn't fix it', 'still broken, try again'.",
        false:
          "A new request, even one that mentions failing tests, bugs, or errors in the code, e.g. 'fix the failing test in foo.ts'.",
      },
    },
    {
      type: "predicate",
      name: "ui_work",
      instructions:
        "To complete `latest_user_message`, will the agent have to write or change code that adds or changes a user interface or user experience: screens, pages, components, layout, styling, text shown in the UI, or interaction flows?",
      criteria: {
        true: "An implementation task whose changes users will see or interact with, e.g. 'add a settings page', 'restyle the header', 'show a toast when it fails', or a ticket whose acceptance criteria mention viewports, components, or loading and error states.",
        false:
          "Server, data, API, configuration, or tooling work with no UI change; a question about a UI; and reviewing or testing a UI in a browser without changing its code.",
      },
    },
  ]
  if (state.previous_route && state.previous_user_message) {
    questions.push({
      type: "predicate",
      name: "follow_up",
      instructions:
        "Is `latest_user_message` a continuation of the same task as `previous_user_message` (an answer, a confirmation, a small tweak, or 'continue'), rather than a new, different task?",
    })
  }
  return questions
}

export type RouteDecision = { route: Route; reason: string }

const MIN_CATEGORY_CONFIDENCE = 0.4

// Categories where the agent writes product code, so the UI rule can apply.
const IMPLEMENTATION: ReadonlySet<Category> = new Set<Category>([
  "scoped_coding",
  "everyday_engineering",
  "major_refactor_architecture",
  "unsure",
])

const isFable = (name: Category) => CATEGORIES[name].start >= FABLE_MEDIUM

export function decideRoute(answers: readonly DecisionAnswer[], previous?: Route): RouteDecision {
  const find = <T extends DecisionAnswer["type"]>(name: string, type: T) =>
    answers.find((a): a is Extract<DecisionAnswer, { type: T }> => a.name === name && a.type === type)

  const category = find("category", "choice")
  const difficulty = find("difficulty", "score")
  const shortfall = (find("shortfall", "predicate")?.probability ?? 0) > 0.5
  const followUp = (find("follow_up", "predicate")?.probability ?? 0) > 0.5

  const picked = category && category.confidence >= MIN_CATEGORY_CONFIDENCE ? String(category.choice) : "unsure"
  let name: Category = picked in CATEGORIES ? (picked as Category) : "unsure"
  // A Fable category that didn't win clearly is treated as everyday engineering (Opus).
  const share = category?.probabilities.find((p) => p.value === name)?.probability ?? 0
  if (isFable(name) && share < MIN_FABLE_PROBABILITY) name = "everyday_engineering"

  const ui = IMPLEMENTATION.has(name) && (find("ui_work", "predicate")?.probability ?? 0) > 0.5
  const previousRung = previous ? rung(previous.model, previous.effort) : -1

  // Switch at a natural break: a model switch rewrites the prompt cache and can
  // drop earlier thinking, so stay put while the user continues the same task.
  // UI work is the exception: it moves up to Opus `high` if the session is below it.
  if (previous && followUp && !shortfall) {
    if (ui && previousRung < UI_ROUTE) return { route: LADDER[UI_ROUTE] ?? DEFAULT_ROUTE, reason: "follow-up, UI/UX work" }
    return { route: previous, reason: "follow-up, keeping model" }
  }

  const level = confidentLevel(difficulty)
  // Fable categories start at `medium` and reach `high` only for the hardest work.
  // Other categories climb one rung per difficulty level and stop at Fable `medium`.
  const fromCategory = isFable(name)
    ? level === 2
      ? FABLE_HIGH
      : FABLE_MEDIUM
    : Math.min(CATEGORIES[name].start + level, FABLE_MEDIUM)
  // After a shortfall, climb exactly one rung above the route that fell short:
  // raise effort one level, or past `high` move to the next model at a lower effort.
  let index = shortfall ? (previousRung >= 0 ? previousRung + 1 : fromCategory + 1) : fromCategory
  if (ui) index = Math.max(index, UI_ROUTE)
  index = Math.min(index, LADDER.length - 1)

  const route = LADDER[index] ?? DEFAULT_ROUTE
  const parts: string[] = [name.replaceAll("_", " "), DIFFICULTY[level]?.label ?? "routine"]
  if (ui) parts.push("UI/UX work")
  if (shortfall) parts.push("escalated after shortfall")
  return { route, reason: parts.join(", ") }
}

// The highest difficulty level Jev is confident the work reaches: 0 routine, 1 demanding, 2 hardest.
function confidentLevel(difficulty: Extract<DecisionAnswer, { type: "score" }> | undefined): number {
  if (!difficulty) return 0
  const p = (level: number) =>
    difficulty.probabilities.find((x) => x.label === DIFFICULTY[level]?.label)?.probability ?? 0
  if (p(2) >= MIN_ESCALATION_PROBABILITY) return 2
  if (p(1) + p(2) >= MIN_ESCALATION_PROBABILITY) return 1
  return 0
}

export const formatRoute = (r: Route) => `${r.model}/${r.effort}`
