export const WIZARD_METADATA_KEY = "local.wizard.definition"
export const WIZARD_RUN_METADATA_KEY = "local.wizard.run"
export const WIZARD_SCHEMA_VERSION = 1

export type WizardDestination =
  | { kind: "env"; file: string; key: string }
  | { kind: "github-secret"; name: string }
  | { kind: "github-variable"; name: string }

export interface WizardCapture {
  id: string
  label: string
  hint?: string
  sensitivity: "public" | "secret"
  prefix?: string
  destinations: WizardDestination[]
}

export interface WizardStage {
  id: string
  title: string
  estimateMinutes: number
  intro?: string
  url?: string
  irreversible?: string
  instructions: string[]
  captures: WizardCapture[]
}

export interface WizardDefinition {
  schemaVersion: 1
  id: string
  title: string
  summary: string
  stages: WizardStage[]
}

export interface WizardPublication {
  publicationID: string
  definition: WizardDefinition
  scope: {
    projectID: string
    directory: string
    subpath?: string
    hostID: string
  }
}

export type WizardParseResult =
  | { ok: true; definition: WizardDefinition }
  | { ok: false; error: string }

type WizardParseFailure = Extract<WizardParseResult, { ok: false }>

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const GITHUB_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

function validEnvFile(file: string): boolean {
  const parts = file.split(/[\\/]/)
  const name = parts.at(-1) ?? ""
  const disallowed = new Set([".env.example", ".env.sample", ".env.template"])
  return (
    /^\.env(?:\.[A-Za-z0-9_-]+)?$/.test(name) &&
    !disallowed.has(name) &&
    parts.slice(0, -1).every((part) => part !== "" && !part.startsWith("."))
  )
}

export const WIZARD_INPUT_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: { type: "integer", const: WIZARD_SCHEMA_VERSION },
    id: { type: "string", pattern: ID_PATTERN.source, maxLength: 64 },
    title: { type: "string", minLength: 1, maxLength: 100 },
    summary: { type: "string", minLength: 1, maxLength: 500 },
    stages: {
      type: "array",
      minItems: 1,
      maxItems: 30,
      items: {
        type: "object",
        properties: {
          id: { type: "string", pattern: ID_PATTERN.source, maxLength: 64 },
          title: { type: "string", minLength: 1, maxLength: 100 },
          estimateMinutes: { type: "integer", minimum: 1, maximum: 120 },
          intro: { type: "string", minLength: 1, maxLength: 500 },
          url: { type: "string", minLength: 1, maxLength: 2048 },
          irreversible: { type: "string", minLength: 1, maxLength: 500 },
          instructions: {
            type: "array",
            maxItems: 20,
            items: { type: "string", minLength: 1, maxLength: 500 },
          },
          captures: {
            type: "array",
            maxItems: 20,
            items: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  pattern: ID_PATTERN.source,
                  maxLength: 64,
                },
                label: { type: "string", minLength: 1, maxLength: 200 },
                hint: { type: "string", minLength: 1, maxLength: 300 },
                sensitivity: { type: "string", enum: ["public", "secret"] },
                prefix: { type: "string", minLength: 1, maxLength: 100 },
                destinations: {
                  type: "array",
                  minItems: 1,
                  maxItems: 5,
                  items: {
                    oneOf: [
                      {
                        type: "object",
                        properties: {
                          kind: { const: "env" },
                          file: {
                            type: "string",
                            minLength: 1,
                            maxLength: 300,
                          },
                          key: {
                            type: "string",
                            pattern: ENV_KEY_PATTERN.source,
                          },
                        },
                        required: ["kind", "file", "key"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          kind: { const: "github-secret" },
                          name: {
                            type: "string",
                            pattern: GITHUB_NAME_PATTERN.source,
                          },
                        },
                        required: ["kind", "name"],
                        additionalProperties: false,
                      },
                      {
                        type: "object",
                        properties: {
                          kind: { const: "github-variable" },
                          name: {
                            type: "string",
                            pattern: GITHUB_NAME_PATTERN.source,
                          },
                        },
                        required: ["kind", "name"],
                        additionalProperties: false,
                      },
                    ],
                  },
                },
              },
              required: ["id", "label", "sensitivity", "destinations"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "id",
          "title",
          "estimateMinutes",
          "instructions",
          "captures",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["schemaVersion", "id", "title", "summary", "stages"],
  additionalProperties: false,
} as const

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined
  return value as Record<string, unknown>
}

function text(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): string | WizardParseFailure {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum
  ) {
    return {
      ok: false,
      error: `${label} must contain ${minimum}-${maximum} characters.`,
    }
  }
  return value
}

function optionalText(
  value: unknown,
  label: string,
  maximum: number,
): string | undefined | WizardParseFailure {
  if (value === undefined) return undefined
  return text(value, label, 1, maximum)
}

function isFailure(
  value: unknown,
): value is Extract<WizardParseResult, { ok: false }> {
  return record(value)?.ok === false
}

function parseDestination(
  value: unknown,
  path: string,
): WizardDestination | WizardParseFailure {
  const input = record(value)
  if (input === undefined)
    return { ok: false, error: `${path} must be an object.` }

  if (input.kind === "env") {
    const file = text(input.file, `${path}.file`, 1, 300)
    if (isFailure(file)) return file
    const key = text(input.key, `${path}.key`, 1, 200)
    if (isFailure(key)) return key
    if (!ENV_KEY_PATTERN.test(key))
      return {
        ok: false,
        error: `${path}.key is not a valid environment key.`,
      }
    if (
      file.startsWith("/") ||
      /^[A-Za-z]:[\\/]/.test(file) ||
      file.split(/[\\/]/).some((part) => part === "..") ||
      !validEnvFile(file)
    ) {
      return {
        ok: false,
        error: `${path}.file must name a .env file inside a non-hidden project directory.`,
      }
    }
    return { kind: "env", file, key }
  }

  if (input.kind === "github-secret" || input.kind === "github-variable") {
    const name = text(input.name, `${path}.name`, 1, 200)
    if (isFailure(name)) return name
    if (!GITHUB_NAME_PATTERN.test(name)) {
      return { ok: false, error: `${path}.name is not a valid GitHub name.` }
    }
    return { kind: input.kind, name }
  }

  return { ok: false, error: `${path}.kind is not supported.` }
}

function parseCapture(
  value: unknown,
  path: string,
): WizardCapture | WizardParseFailure {
  const input = record(value)
  if (input === undefined)
    return { ok: false, error: `${path} must be an object.` }

  const id = text(input.id, `${path}.id`, 1, 64)
  if (isFailure(id)) return id
  if (!ID_PATTERN.test(id))
    return { ok: false, error: `${path}.id is not valid.` }
  const label = text(input.label, `${path}.label`, 1, 200)
  if (isFailure(label)) return label
  const hint = optionalText(input.hint, `${path}.hint`, 300)
  if (isFailure(hint)) return hint
  if (input.sensitivity !== "public" && input.sensitivity !== "secret") {
    return {
      ok: false,
      error: `${path}.sensitivity must be public or secret.`,
    }
  }
  const prefix = optionalText(input.prefix, `${path}.prefix`, 100)
  if (isFailure(prefix)) return prefix
  if (
    !Array.isArray(input.destinations) ||
    input.destinations.length < 1 ||
    input.destinations.length > 5
  ) {
    return { ok: false, error: `${path}.destinations must contain 1-5 items.` }
  }

  const destinations: WizardDestination[] = []
  for (const [index, destination] of input.destinations.entries()) {
    const parsed = parseDestination(
      destination,
      `${path}.destinations[${index}]`,
    )
    if (isFailure(parsed)) return parsed
    if (input.sensitivity === "secret" && parsed.kind === "github-variable") {
      return {
        ok: false,
        error: `${path} cannot write a secret to a GitHub variable.`,
      }
    }
    if (input.sensitivity === "public" && parsed.kind === "github-secret") {
      return {
        ok: false,
        error: `${path} must classify a GitHub secret as secret.`,
      }
    }
    destinations.push(parsed)
  }

  return {
    id,
    label,
    hint,
    sensitivity: input.sensitivity,
    prefix,
    destinations,
  }
}

function parseStage(
  value: unknown,
  path: string,
): WizardStage | WizardParseFailure {
  const input = record(value)
  if (input === undefined)
    return { ok: false, error: `${path} must be an object.` }

  const id = text(input.id, `${path}.id`, 1, 64)
  if (isFailure(id)) return id
  if (!ID_PATTERN.test(id))
    return { ok: false, error: `${path}.id is not valid.` }
  const title = text(input.title, `${path}.title`, 1, 100)
  if (isFailure(title)) return title
  if (
    !Number.isInteger(input.estimateMinutes) ||
    Number(input.estimateMinutes) < 1 ||
    Number(input.estimateMinutes) > 120
  ) {
    return {
      ok: false,
      error: `${path}.estimateMinutes must be an integer from 1 to 120.`,
    }
  }
  const intro = optionalText(input.intro, `${path}.intro`, 500)
  if (isFailure(intro)) return intro
  const url = optionalText(input.url, `${path}.url`, 2048)
  if (isFailure(url)) return url
  if (url !== undefined) {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
        throw new Error("protocol")
    } catch {
      return { ok: false, error: `${path}.url must be an HTTP or HTTPS URL.` }
    }
  }
  const irreversible = optionalText(
    input.irreversible,
    `${path}.irreversible`,
    500,
  )
  if (isFailure(irreversible)) return irreversible
  if (!Array.isArray(input.instructions) || input.instructions.length > 20) {
    return {
      ok: false,
      error: `${path}.instructions must contain at most 20 items.`,
    }
  }
  const instructions: string[] = []
  for (const [index, instruction] of input.instructions.entries()) {
    const parsed = text(instruction, `${path}.instructions[${index}]`, 1, 500)
    if (isFailure(parsed)) return parsed
    instructions.push(parsed)
  }
  if (!Array.isArray(input.captures) || input.captures.length > 20) {
    return {
      ok: false,
      error: `${path}.captures must contain at most 20 items.`,
    }
  }
  const captures: WizardCapture[] = []
  for (const [index, capture] of input.captures.entries()) {
    const parsed = parseCapture(capture, `${path}.captures[${index}]`)
    if (isFailure(parsed)) return parsed
    captures.push(parsed)
  }
  if (instructions.length === 0 && captures.length === 0) {
    return {
      ok: false,
      error: `${path} must contain an instruction or captured value.`,
    }
  }

  return {
    id,
    title,
    estimateMinutes: Number(input.estimateMinutes),
    intro,
    url,
    irreversible,
    instructions,
    captures,
  }
}

export function parseWizardDefinition(value: unknown): WizardParseResult {
  const input = record(value)
  if (input === undefined)
    return { ok: false, error: "Wizard definition must be an object." }
  if (input.schemaVersion !== WIZARD_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Wizard schemaVersion must be ${WIZARD_SCHEMA_VERSION}.`,
    }
  }

  const id = text(input.id, "id", 1, 64)
  if (isFailure(id)) return id
  if (!ID_PATTERN.test(id)) return { ok: false, error: "id is not valid." }
  const title = text(input.title, "title", 1, 100)
  if (isFailure(title)) return title
  const summary = text(input.summary, "summary", 1, 500)
  if (isFailure(summary)) return summary
  if (
    !Array.isArray(input.stages) ||
    input.stages.length < 1 ||
    input.stages.length > 30
  ) {
    return { ok: false, error: "stages must contain 1-30 items." }
  }

  const stages: WizardStage[] = []
  const stageIDs = new Set<string>()
  const captureIDs = new Set<string>()
  for (const [index, stage] of input.stages.entries()) {
    const parsed = parseStage(stage, `stages[${index}]`)
    if (isFailure(parsed)) return parsed
    if (stageIDs.has(parsed.id))
      return { ok: false, error: `Duplicate stage id: ${parsed.id}.` }
    stageIDs.add(parsed.id)
    for (const capture of parsed.captures) {
      if (captureIDs.has(capture.id))
        return { ok: false, error: `Duplicate capture id: ${capture.id}.` }
      captureIDs.add(capture.id)
    }
    stages.push(parsed)
  }

  return {
    ok: true,
    definition: {
      schemaVersion: WIZARD_SCHEMA_VERSION,
      id,
      title,
      summary,
      stages,
    },
  }
}

export function parseWizardPublication(
  value: unknown,
): { ok: true; publication: WizardPublication } | { ok: false; error: string } {
  const input = record(value)
  if (input === undefined)
    return { ok: false, error: "Wizard publication must be an object." }
  const definition = parseWizardDefinition(input.definition)
  if (!definition.ok) return definition
  const publicationID = text(input.publicationID, "publicationID", 36, 36)
  if (isFailure(publicationID)) return publicationID
  if (!/^[0-9a-f-]{36}$/.test(publicationID)) {
    return { ok: false, error: "publicationID is not valid." }
  }
  const scope = record(input.scope)
  if (scope === undefined)
    return { ok: false, error: "Wizard publication scope is missing." }
  const projectID = text(scope.projectID, "scope.projectID", 1, 200)
  if (isFailure(projectID)) return projectID
  const directory = text(scope.directory, "scope.directory", 1, 4096)
  if (isFailure(directory)) return directory
  if (!isAbsolutePath(directory)) {
    return { ok: false, error: "scope.directory must be an absolute path." }
  }
  const subpath = optionalText(scope.subpath, "scope.subpath", 1000)
  if (isFailure(subpath)) return subpath
  if (
    subpath !== undefined &&
    (isAbsolutePath(subpath) ||
      subpath.split(/[\\/]/).some((part) => part === ".."))
  ) {
    return { ok: false, error: "scope.subpath must stay inside the project." }
  }
  const hostID = text(scope.hostID, "scope.hostID", 36, 36)
  if (isFailure(hostID)) return hostID
  if (!/^[0-9a-f-]{36}$/.test(hostID)) {
    return { ok: false, error: "scope.hostID is not valid." }
  }
  return {
    ok: true,
    publication: {
      publicationID,
      definition: definition.definition,
      scope: { projectID, directory, subpath, hostID },
    },
  }
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)
}

export function wizardMinutes(definition: WizardDefinition): number {
  return definition.stages.reduce(
    (total, stage) => total + stage.estimateMinutes,
    0,
  )
}

export function destinationLabel(destination: WizardDestination): string {
  if (destination.kind === "env")
    return `${destination.key} → ${destination.file}`
  if (destination.kind === "github-secret")
    return `${destination.name} → GitHub secret`
  return `${destination.name} → GitHub variable`
}
