import { z } from "zod"
import { AssertionNodeDataSchema } from "./AssertionNodeDataSchema"
import { DelayNodeDataSchema } from "./DelayNodeDataSchema"
import { EndNodeDataSchema } from "./EndNodeDataSchema"
import { GroupNodeDataSchema } from "./GroupNodeDataSchema"
import { HTTPNodeDataSchema } from "./HTTPNodeDataSchema"
import { MergeNodeDataSchema } from "./MergeNodeDataSchema"
import { NoteNodeDataSchema } from "./NoteNodeDataSchema"
import { PositionSchema } from "./PositionSchema"
import { StartNodeDataSchema } from "./StartNodeDataSchema"
import { WorkflowCallNodeDataSchema } from "./WorkflowCallNodeDataSchema"

/**
 * Base shape every workflow-node discrimination member shares: identity,
 * label, and position. `config` is the only member-varying field, so it is
 * left to each `extend(...)` call.
 *
 * `label` is nullable-optional to round-trip the persisted `null` label
 * (the canvas writes `null` when the user clears it) without zod
 * `optional()` accepting `undefined`-but-present.
 *
 * `parentId` lives here rather than on one member because a frame can hold any
 * kind of node — declaring it once gives it to all of them, and a member added
 * later cannot forget it.
 */
const baseNode = z.object({
  nodeId: z.string().min(1).describe("Unique id for this node within the workflow; edges reference it by this id."),
  label: z.string().nullable().optional().describe("Display name shown on the canvas."),
  position: PositionSchema.default({ x: 0, y: 0 }).describe("Canvas coordinates. Layout only — it does not affect execution order, which comes from the edges."),
  parentId: z.string().min(1).optional().describe('Node id of the group frame this node sits inside. When set, `position` is relative to that frame. Layout only.'),
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
    .strict()
    .describe("Sends one HTTP request and optionally extracts values from the response into workflow variables. One input, one output."),
  baseNode
    .extend({
      type: z.literal("assertion"),
      config: AssertionNodeDataSchema.optional(),
    })
    .strict()
    .describe(
      'Checks values from the single upstream http-request node and branches on the result. TWO outputs: every outgoing edge MUST set sourceHandle to "pass" or "fail". Exactly one http-request node must be reachable upstream — zero or two makes the source ambiguous and the node fails.',
    ),
  baseNode
    .extend({
      type: z.literal("delay"),
      config: DelayNodeDataSchema.optional(),
    })
    .strict()
    .describe("Waits a fixed duration before continuing. One input, one output."),
  baseNode
    .extend({
      type: z.literal("merge"),
      config: MergeNodeDataSchema.optional(),
    })
    .strict()
    .describe('Joins parallel branches back into one path using a strategy ("all", "any", "first" or "conditional"). Downstream nodes address a specific branch as "{{prev[0]...}}", "{{prev[1]...}}". Many inputs, one output.'),
  baseNode
    .extend({
      type: z.literal("start"),
      config: StartNodeDataSchema.optional(),
    })
    .strict()
    .describe("Entry point. Exactly one per workflow; the run begins here. Output only."),
  baseNode
    .extend({
      type: z.literal("end"),
      config: EndNodeDataSchema.optional(),
    })
    .strict()
    .describe("Terminal point of a path. At least one per workflow; several are allowed for separate success and failure paths. Input only."),
  baseNode
    .extend({
      type: z.literal("workflow"),
      config: WorkflowCallNodeDataSchema.optional(),
    })
    .strict()
    .describe("Runs another workflow in the same workspace inline, as one step, with input/output variable mappings. One input, one output."),
  baseNode
    .extend({
      type: z.literal("group"),
      config: GroupNodeDataSchema.optional(),
    })
    .strict()
    .describe("A frame drawn behind its members. Purely visual: it has no handles, takes no edges and never executes — the runner and the graph validator drop it before they see the graph. Nodes join it by setting `parentId` to its id, which makes their `position` relative to the frame."),
  baseNode
    .extend({
      type: z.literal("note"),
      config: NoteNodeDataSchema.optional(),
    })
    .strict()
    .describe("A sticky note for documenting a workflow branch. Purely visual: it has no handles, takes no edges, and never executes."),
])
