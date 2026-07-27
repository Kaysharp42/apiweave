import { z } from "zod"
import { RevisionSchema } from "./RevisionSchema"
import { WorkflowSchema } from "./WorkflowSchema"

export const AssertionApplyResultSchema = z
  .object({
    workflow: WorkflowSchema,
    revision: RevisionSchema,
  })
  .strict()
