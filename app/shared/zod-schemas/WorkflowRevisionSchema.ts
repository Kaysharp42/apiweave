import { WorkflowRevisionSummarySchema } from "./WorkflowRevisionSummarySchema"
import { WorkflowSchema } from "./WorkflowSchema"

/** An earlier version of a workflow with its content: what restoring it writes back. */
export const WorkflowRevisionSchema = WorkflowRevisionSummarySchema.extend({
  snapshot: WorkflowSchema.pick({
    name: true,
    description: true,
    nodes: true,
    edges: true,
    variables: true,
    tags: true,
    nodeTemplates: true,
  }),
}).strict()
