import { randomUUID } from "node:crypto"

import { Plugin } from "@opencode-ai/plugin"
import type { JsonValue } from "@opencode-ai/client"

import { wizardHostID } from "./host"
import {
  parseWizardDefinition,
  parseWizardPublication,
  WIZARD_INPUT_SCHEMA,
  WIZARD_METADATA_KEY,
  WIZARD_RUN_METADATA_KEY,
  wizardMinutes,
} from "./schema"

export default Plugin.define({
  id: "local.wizard",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "wizard_publish",
        description:
          "Publish a confirmed declarative setup wizard and immediately start it in the user's TUI. Never include captured values or executable code.",
        input: WIZARD_INPUT_SCHEMA,
        execute: async (input, tool) => {
          const parsed = parseWizardDefinition(input)
          if (!parsed.ok)
            throw new Error(`Invalid wizard definition: ${parsed.error}`)
          const session = await ctx.session.get({ sessionID: tool.sessionID })
          const hostID = await wizardHostID()
          const publication = {
            publicationID: randomUUID(),
            definition: parsed.definition,
            scope: {
              projectID: session.projectID,
              directory: session.location.directory,
              subpath: session.subpath,
              hostID,
            },
          }
          await Promise.all([
            ctx.storage.set(
              `publication/${tool.sessionID}/latest`,
              publication as unknown as JsonValue,
            ),
            ctx.storage.set(
              `publication/${tool.sessionID}/${parsed.definition.id}`,
              publication as unknown as JsonValue,
            ),
          ])

          await ctx.session.synthetic({
            sessionID: tool.sessionID,
            text: `Starting wizard: ${parsed.definition.title}.`,
            description: "Native wizard published and started",
            metadata: {
              [WIZARD_METADATA_KEY]: publication as unknown as JsonValue,
              [WIZARD_RUN_METADATA_KEY]: publication as unknown as JsonValue,
            },
          })

          return {
            content: `Published and started “${parsed.definition.title}” with ${parsed.definition.stages.length} stages (about ${wizardMinutes(parsed.definition)} minutes).`,
          }
        },
      })

      editor.add({
        name: "wizard_run",
        description:
          "Run or resume the latest published native wizard in the user's TUI. Call this when the user asks to start, continue, or resume a wizard.",
        input: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description:
                "Optional stable wizard ID. Omit it to run the latest wizard.",
            },
          },
          additionalProperties: false,
        },
        execute: async (input, tool) => {
          const requestedID =
            typeof (input as { id?: unknown }).id === "string"
              ? (input as { id: string }).id
              : undefined
          const stored = await ctx.storage.get(
            `publication/${tool.sessionID}/${requestedID ?? "latest"}`,
          )
          const parsed = parseWizardPublication(stored)
          if (!parsed.ok) {
            throw new Error(
              requestedID === undefined
                ? "No wizard has been published in this session."
                : `No wizard with ID “${requestedID}” has been published in this session.`,
            )
          }
          const publication = parsed.publication

          await ctx.session.synthetic({
            sessionID: tool.sessionID,
            text: `Starting wizard: ${publication.definition.title}.`,
            description: "Native wizard run requested",
            metadata: {
              [WIZARD_RUN_METADATA_KEY]: publication as unknown as JsonValue,
            },
          })
          return {
            content: `Started “${publication.definition.title}” in the TUI.`,
          }
        },
      })
    })
  },
})
