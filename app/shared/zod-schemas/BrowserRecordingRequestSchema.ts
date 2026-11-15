import { z } from "zod"

/** What the canvas asks main for when the user starts recording. */
export const BrowserRecordingRequestSchema = z
  .object({
    workspaceId: z.string().min(1),
    workflowId: z.string().min(1),
    environmentId: z
      .string()
      .min(1)
      .nullable()
      .describe("The environment selected on the canvas. Typed values equal to its variables become `{{env.*}}`; its secrets and the workspace's become `{{secrets.*}}`."),
    startUrl: z
      .string()
      .min(1)
      .max(2_048)
      .describe("The page the recording opens. May contain `{{env.*}}` placeholders, filled from the environment."),
  })
  .strict()
