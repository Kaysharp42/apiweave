import { z } from "zod"
import { JsonValueSchema } from "@shared/zod-schemas"
import { BrowserInspectionSchema } from "@shared/zod-schemas/BrowserInspectionSchema"
import type { IpcRouter } from "../router"
import type { HandlerDeps } from "./common"
import { BROWSER_INSPECT_SNAPSHOT_DEFAULT_BYTES, BROWSER_INSPECT_SNAPSHOT_MAX_BYTES } from "../../services/read_budgets"

const inspectInput = z
  .object({
    workspaceId: z.string().min(1),
    workflowId: z.string().min(1),
    beforeNodeId: z.string().min(1).optional().describe("Run every step before this node, then read the page. Omitted: run the whole workflow and read the page it ends on."),
    selectedEnvironmentId: z.string().nullable().optional().describe("Environment to run against. Omitted: the workflow's own; null: none."),
    variables: z.record(z.string(), JsonValueSchema).optional().describe("Run variables, as for runs_create."),
    screenshot: z.boolean().optional().describe("Also return a JPEG of the viewport as image content (password fields and secret values painted over, at most 1 MB). Default false: the ARIA snapshot is usually enough to pick locators."),
    maxBytes: z
      .number()
      .int()
      .min(256)
      .max(BROWSER_INSPECT_SNAPSHOT_MAX_BYTES)
      .optional()
      .describe(`ARIA snapshot bytes to return (default ${BROWSER_INSPECT_SNAPSHOT_DEFAULT_BYTES}, max ${BROWSER_INSPECT_SNAPSHOT_MAX_BYTES}).`),
  })
  .strict()

export function registerBrowserHandlers(router: IpcRouter, deps: HandlerDeps): void {
  // Sends real traffic like `runs.create`: the run is recorded, and an agent's
  // run asks the user before it sends secrets. Always headless.
  router.register("browser", "inspect", {
    input: inspectInput,
    output: BrowserInspectionSchema,
    handle: ({ workspaceId, screenshot, maxBytes, ...input }, context) =>
      deps.runs.inspectBrowser(
        workspaceId,
        { ...input, screenshot: screenshot ?? false, maxBytes: maxBytes ?? BROWSER_INSPECT_SNAPSHOT_DEFAULT_BYTES },
        {
          ...(context?.agent !== undefined ? { agent: context.agent } : {}),
          ...(context?.signal !== undefined ? { signal: context.signal } : {}),
        },
      ),
  })
}
