import { z } from "zod"

/**
 * Per-node CONFIG schema for `type: "end"` nodes. See
 * {@link StartNodeDataSchema}.
 */
export const EndNodeDataSchema = z.object({}).strict()