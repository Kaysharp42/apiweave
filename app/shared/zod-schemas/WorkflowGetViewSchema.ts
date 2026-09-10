import { z } from "zod"
import { WorkflowOutlineViewSchema } from "./WorkflowOutlineViewSchema"
import { WorkflowNodesViewSchema } from "./WorkflowNodesViewSchema"
import { WorkflowSchema } from "./WorkflowSchema"

/**
 * The three `workflows.get` read shapes. `full` is the complete stored graph
 * the renderer edits against; `outline` and `nodes` are explicitly partial
 * agent reads that never present a filtered graph as complete.
 */
export const WorkflowGetViewSchema = z.union([WorkflowSchema, WorkflowOutlineViewSchema, WorkflowNodesViewSchema])
