import { z } from "zod"
import { RunArtifactSchema } from "./RunArtifactSchema"

/**
 * What `browser.inspect` returns: the run it made, and the page that run left
 * open. Every page string went through the run's masker; the URL has its query
 * and fragment redacted.
 */
export const BrowserInspectionSchema = z
  .object({
    runId: z.string().min(1).describe("The run inspect made. It is in run history like any run; read a failed step with runs_getNodeResult."),
    status: z.enum(["completed", "failed", "cancelled", "interrupted"]),
    stoppedBeforeNodeId: z.string().optional().describe("The node the run stopped before. Absent: the whole workflow ran."),
    failedNodeIds: z.array(z.string()),
    error: z.string().optional().describe("The run's error, when it failed."),
    page: z
      .object({
        url: z.string(),
        title: z.string(),
        ariaSnapshot: z
          .object({
            preview: z.string(),
            previewTruncated: z.boolean(),
            totalBytes: z.number().int().nonnegative(),
          })
          .strict()
          .optional()
          .describe("The page's accessibility tree in Playwright's ARIA snapshot format: roles, accessible names, and field values (secrets masked). Pick role and label locators from it."),
      })
      .strict()
      .nullable()
      .describe("The page as the run left it. Null when no browser step ran, so no page was open."),
    note: z.string().optional().describe("What could not be read, and why."),
    screenshot: RunArtifactSchema.optional().describe("A JPEG of the viewport, password fields and masked values painted over. Sent to agents as image content, not text."),
  })
  .strict()
