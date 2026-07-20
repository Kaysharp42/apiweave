import { z } from "zod"
import { AssertionNodeDataSchema } from "./AssertionNodeDataSchema"
import { DelayNodeDataSchema } from "./DelayNodeDataSchema"
import { EndNodeDataSchema } from "./EndNodeDataSchema"
import { HTTPNodeDataSchema } from "./HTTPNodeDataSchema"
import { MergeNodeDataSchema } from "./MergeNodeDataSchema"
import { PositionSchema } from "./PositionSchema"
import { StartNodeDataSchema } from "./StartNodeDataSchema"

/**
 * Base shape every workflow-node discrimination member shares: identity,
 * label, and position. `config` is the only member-varying field, so it is
 * left to each `extend(...)` call.
 *
 * `label` is nullable-optional to round-trip the persisted `null` label
 * (the canvas writes `null` when the user clears it) without zod
 * `optional()` accepting `undefined`-but-present.
 */
const baseNode = z.object({
  nodeId: z.string().min(1),
  label: z.string().nullable().optional(),
  position: PositionSchema.default({ x: 0, y: 0 }),
})

/**
 * Discriminated union over `type` so a node carries exactly the config
 * shape its `type` permits — a `delay` node with a `headers` field is
 * rejected at validation, not silently passed through, and a `merge`
 * node can no longer smuggle a `method` field by matching the
 * `http-request` union arm first.
 *
 * Each member is `.strict()` so an unknown field on any member fails
 * validation: the persisted workflow graph is a closed contract, not a bag
 * of maybe-typed fields, and a persisted row that drifts from the contract
 * should surface as a `validation` failure — not the silent
 * "HTTP-500-via-rethrown-ZodError" that motivated this rewrite
 * (`router.dispatch` validates OUTSIDE its try/catch — see
 * `app/core/ipc/router.ts:126`).
 */
export const WorkflowNodeSchema = z.discriminatedUnion("type", [
  baseNode
    .extend({
      type: z.literal("http-request"),
      config: HTTPNodeDataSchema.optional(),
    })
    .strict(),
  baseNode
    .extend({
      type: z.literal("assertion"),
      config: AssertionNodeDataSchema.optional(),
    })
    .strict(),
  baseNode
    .extend({
      type: z.literal("delay"),
      config: DelayNodeDataSchema.optional(),
    })
    .strict(),
  baseNode
    .extend({
      type: z.literal("merge"),
      config: MergeNodeDataSchema.optional(),
    })
    .strict(),
  baseNode
    .extend({
      type: z.literal("start"),
      config: StartNodeDataSchema.optional(),
    })
    .strict(),
  baseNode
    .extend({
      type: z.literal("end"),
      config: EndNodeDataSchema.optional(),
    })
    .strict(),
])