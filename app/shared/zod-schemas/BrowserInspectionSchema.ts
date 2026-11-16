import { z } from "zod"
import { RunArtifactSchema } from "./RunArtifactSchema"

/**
 * What `browser.inspect` returns: the run it made or resumed, and the page that
 * run left open. Every page string went through the run's masker; the URL has
 * its query and fragment redacted. A run still pending or running at the wait
 * deadline returns no page (terminal: false) and is continued by runId.
 */
export const BrowserInspectionSchema = z
  .object({
    runId: z.string().min(1).describe("The run inspect made or resumed. It is in run history like any run; read a failed step with runs_getNodeResult."),
    status: z.enum(["pending", "running", "completed", "failed", "cancelled", "interrupted"]),
    terminal: z.boolean().describe("False when the run had not finished by the deadline: call browser_inspect with this runId to keep waiting."),
    deniedByUser: z.boolean().describe("True: the user refused to let this run send secrets, or did not answer — tell them, do not retry."),
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
