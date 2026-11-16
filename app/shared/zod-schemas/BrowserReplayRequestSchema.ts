import { z } from "zod"

/**
 * What the canvas asks main for to re-pick a step's element or re-record from
 * a step: replay the workflow up to that step in a browser on the user's
 * screen, then hand the page to the user.
 */
export const BrowserReplayRequestSchema = z
  .object({
    workspaceId: z.string().min(1),
    workflowId: z.string().min(1),
    environmentId: z
      .string()
      .min(1)
      .nullable()
      .describe("The environment selected on the canvas: the replay runs with it, and recorded values are templated from it."),
    nodeId: z.string().min(1).describe("The browser step: the replay stops before it."),
  })
  .strict()
