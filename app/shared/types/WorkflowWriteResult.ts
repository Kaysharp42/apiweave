import type { z } from "zod"
import type { WorkflowWriteResultSchema } from "../zod-schemas/WorkflowWriteResultSchema"

/**
 * One of:
 *  - the full persisted {@link Workflow} (`return: "full"` — the default for
 *    `workflows_create` / `workflows_update`, what the renderer reads back);
 *  - a `{ kind: "summary" }` projection (`return: "summary"`, the default for
 *    `workflows_patch`) with `workflowId`, `rev`, node/edge counts, the ids the
 *    write touched, and the full diagnosis;
 *  - a `{ kind: "diagnosis" }` projection (`return: "diagnosis"`) with only
 *    `workflowId`, `rev` and `diagnosis`.
 */
export type WorkflowWriteResult = z.infer<typeof WorkflowWriteResultSchema>