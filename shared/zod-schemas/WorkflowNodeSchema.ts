import { z } from "zod"
import { AssertionNodeDataSchema } from "./AssertionNodeDataSchema"
import { DelayNodeDataSchema } from "./DelayNodeDataSchema"
import { EndNodeDataSchema } from "./EndNodeDataSchema"
import { HTTPNodeDataSchema } from "./HTTPNodeDataSchema"
import { MergeNodeDataSchema } from "./MergeNodeDataSchema"
import { PositionSchema } from "./PositionSchema"
import { StartNodeDataSchema } from "./StartNodeDataSchema"

const WorkflowNodeDataSchema = z.union([
  HTTPNodeDataSchema,
  AssertionNodeDataSchema,
  DelayNodeDataSchema,
  MergeNodeDataSchema,
  StartNodeDataSchema,
  EndNodeDataSchema,
])

export const WorkflowNodeSchema = z
  .object({
    nodeId: z.string().min(1),
    type: z.enum(["http-request", "assertion", "delay", "merge", "start", "end"]),
    label: z.string().nullable().optional(),
    position: PositionSchema.default({ x: 0, y: 0 }),
    config: WorkflowNodeDataSchema.optional(),
  })
  .strict()
