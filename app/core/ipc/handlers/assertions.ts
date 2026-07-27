import { z } from "zod"
import {
  AssertionApplyResultSchema,
  AssertionItemSchema,
  AssertionSuggestionResultSchema,
  AssertionValidationResultSchema,
  JsonValueSchema,
  RevisionSchema,
} from "@shared/zod-schemas"
import type { IpcRouter } from "../router"
import type { HandlerDeps } from "./common"

const id = z.string().min(1)
const baseInput = z.object({ workspaceId: id, workflowId: id, sourceNodeId: id }).strict()
const draftRule = z
  .object({
    source: z.string().min(1),
    path: z.string().optional(),
    operator: z.string().min(1),
    expectedValue: JsonValueSchema.optional(),
  })
  .strict()

export function registerAssertionHandlers(router: IpcRouter, deps: HandlerDeps): void {
  const { assertionAuthoring } = deps

  router.register("assertions", "suggest", {
    input: baseInput.extend({ runId: id }).strict(),
    output: AssertionSuggestionResultSchema,
    handle: (input) => assertionAuthoring.suggest(
      input.workspaceId,
      input.workflowId,
      input.runId,
      input.sourceNodeId,
    ),
  })

  router.register("assertions", "validate", {
    input: baseInput.extend({ rules: z.array(draftRule), runId: id.optional() }).strict(),
    output: AssertionValidationResultSchema,
    handle: (input) => assertionAuthoring.validate(
      input.workspaceId,
      input.workflowId,
      input.sourceNodeId,
      input.rules,
      input.runId,
    ),
  })

  router.register("assertions", "apply", {
    input: z
      .object({
        workspaceId: id,
        workflowId: id,
        expectedRevision: RevisionSchema,
        assertionNodeId: id,
        mode: z.enum(["append", "replace"]),
        rules: z.array(AssertionItemSchema).min(1),
      })
      .strict(),
    output: AssertionApplyResultSchema,
    handle: (input) => assertionAuthoring.apply(
      input.workspaceId,
      input.workflowId,
      input.expectedRevision,
      input.assertionNodeId,
      input.mode,
      input.rules,
    ),
  })
}
