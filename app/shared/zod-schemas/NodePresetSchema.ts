import { z } from "zod"
import { AssertionNodeDataSchema } from "./AssertionNodeDataSchema"
import { DelayNodeDataSchema } from "./DelayNodeDataSchema"
import { HTTPNodeDataSchema } from "./HTTPNodeDataSchema"
import { JsonValueSchema } from "./JsonValueSchema"
import { MergeNodeDataSchema } from "./MergeNodeDataSchema"
import { NodePresetNodeTypeSchema } from "./NodePresetNodeTypeSchema"
import { RevisionSchema } from "./RevisionSchema"
import { TimestampSchema } from "./TimestampSchema"
import { WorkflowCallNodeDataSchema } from "./WorkflowCallNodeDataSchema"

/**
 * A named, workspace-scoped, persisted node config (FEATURE-IDEAS §6.2) —
 * draggable onto any canvas in the workspace.
 *
 * `config` is typed as an open JSON record here rather than a discriminated
 * union on `nodeType`, because this schema also validates rows read back from
 * disk and a discriminated `config` would make a preset saved before a node
 * type gained a field unreadable. The per-`nodeType` shape IS enforced, but at
 * the write boundary — `NodePresetService` runs
 * {@link nodePresetConfigSchemaFor} on create/update, so a preset can never
 * hold a config its node type would reject.
 */
export const NodePresetSchema = z
  .object({
    presetId: z.string().min(1),
    workspaceId: z.string().min(1),
    name: z.string().min(1),
    nodeType: NodePresetNodeTypeSchema,
    config: z.record(z.string(), JsonValueSchema).default({}),
    rev: RevisionSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()

const CONFIG_SCHEMA_BY_NODE_TYPE = {
  "http-request": HTTPNodeDataSchema,
  assertion: AssertionNodeDataSchema,
  delay: DelayNodeDataSchema,
  merge: MergeNodeDataSchema,
  workflow: WorkflowCallNodeDataSchema,
} as const satisfies Record<z.infer<typeof NodePresetNodeTypeSchema>, z.ZodType>

/** The node-data schema a preset's `config` must satisfy for a given `nodeType`. */
export function nodePresetConfigSchemaFor(nodeType: z.infer<typeof NodePresetNodeTypeSchema>): z.ZodType {
  return CONFIG_SCHEMA_BY_NODE_TYPE[nodeType]
}
