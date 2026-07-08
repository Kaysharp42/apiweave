import { z } from "zod"

/**
 * Per-node CONFIG schema for `type: "start"` nodes. The node has no
 * config payload; the schema exists so {@link WorkflowNodeSchema} keeps a
 * discriminated member per `type` rather than silently falling through to
 * a generic record.
 *
 * See {@link HTTPNodeDataSchema} for the rationale on dropping the legacy
 * double-nested `config.config` wrapper and runtime fields.
 */
export const StartNodeDataSchema = z.object({}).strict()