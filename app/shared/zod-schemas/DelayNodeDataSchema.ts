import { z } from "zod"
import { DelayJitterConfigSchema } from "./DelayJitterConfigSchema"

/**
 * Per-node CONFIG schema for `type: "delay"` nodes.
 *
 * Runtime canvas state (`label`, `executionStatus`) lives on the renderer's
 * `WorkflowCanvasNodeData` and is intentionally absent from the persisted
 * workflow definition. See {@link HTTPNodeDataSchema} for the rationale on
 * dropping the legacy double-nested `config.config` wrapper.
 */
export const DelayNodeDataSchema = z
  .object({
    duration: z.number().int().nonnegative().optional(),
    jitter: DelayJitterConfigSchema.optional(),
    continueOnFail: z.boolean().optional(),
  })
  .strict()