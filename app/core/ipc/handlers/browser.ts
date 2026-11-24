import { z } from "zod"
import { JsonValueSchema, AriaScopeSchema } from "@shared/zod-schemas"
import { BrowserInspectionSchema } from "@shared/zod-schemas/BrowserInspectionSchema"
import type { IpcRouter } from "../router"
import type { HandlerDeps } from "./common"
import { unknownKeyError } from "./common"
import {
  BROWSER_INSPECT_SNAPSHOT_DEFAULT_BYTES,
  BROWSER_INSPECT_SNAPSHOT_MAX_BYTES,
  RUN_WAIT_DEFAULT_MS,
  RUN_WAIT_MAX_MS,
} from "../../services/read_budgets"

const inspectInput = z
  .strictObject(
    {
      workspaceId: z.string().min(1),
      workflowId: z.string().min(1).optional().describe("Start an inspection run of this workflow. Pass exactly one of workflowId and runId."),
      runId: z
        .string()
        .min(1)
        .optional()
        .describe("Continue an inspection started earlier: waits on that run and returns its page, starting nothing. Mutually exclusive with workflowId, beforeNodeId, selectedEnvironmentId, variables and screenshot."),
      beforeNodeId: z.string().min(1).optional().describe("Run every step before this node, then read the page: the page as it is just before this node runs — the page the step acts on. Omitted: run the whole workflow and read the page it ends on."),
      selectedEnvironmentId: z.string().min(1).nullable().optional().describe("Environment to run against. Omitted: the workflow's own; null: none."),
      variables: z.record(z.string(), JsonValueSchema).optional().describe("Run variables, as for runs_create."),
      screenshot: z.boolean().optional().describe("Also return a JPEG of the viewport as image content (password fields and secret values painted over, at most 1 MB). Default false: the ARIA snapshot is usually enough to pick locators."),
      maxBytes: z
        .number()
        .int()
        .min(256)
        .max(BROWSER_INSPECT_SNAPSHOT_MAX_BYTES)
        .optional()
        .describe(`ARIA snapshot bytes to return (default ${BROWSER_INSPECT_SNAPSHOT_DEFAULT_BYTES}, max ${BROWSER_INSPECT_SNAPSHOT_MAX_BYTES}), counted on the scoped text.`),
      scope: AriaScopeSchema.optional(),
      start: z.number().int().min(0).optional().describe("Start byte offset into the scoped ARIA snapshot; rounded down to a character boundary."),
      end: z.number().int().min(0).optional().describe("End byte offset into the scoped ARIA snapshot, rounded down to a character boundary; must exceed start."),
      waitMs: z
        .number()
        .int()
        .min(0)
        .max(RUN_WAIT_MAX_MS)
        .optional()
        .describe(`How long to wait for the page in ms (default ${RUN_WAIT_DEFAULT_MS}, max ${RUN_WAIT_MAX_MS}). 0 returns the current state immediately. On deadline the result is terminal:false with the runId to pass back here; a timeout or disconnect never cancels the run.`),
    },
    {
      // The one alias agents reach for: other node-naming tools take a plain
      // `nodeId`, but this tool's node parameter names a *boundary*, so it
      // keeps its role-specific name — and the error says so instead of
      // leaving zod's bare "Unrecognized key" to explain it.
      error: unknownKeyError({
        nodeId: "This tool has no nodeId — to read the page before a node runs, pass beforeNodeId.",
      }),
    },
  )
  .superRefine((value, context) => {
    if ((value.workflowId === undefined) === (value.runId === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workflowId"],
        message: "Pass exactly one of workflowId (start an inspection) and runId (continue one).",
      })
    }
    if (value.runId !== undefined) {
      for (const field of ["beforeNodeId", "selectedEnvironmentId", "variables", "screenshot"] as const) {
        if (value[field] !== undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} belongs to the run runId names: it cannot be changed when continuing.`,
          })
        }
      }
    }
    if (value.start !== undefined && value.end !== undefined && value.end <= value.start) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["end"], message: "end must be greater than start." })
    }
  })

export function registerBrowserHandlers(router: IpcRouter, deps: HandlerDeps): void {
  // Sends real traffic like `runs.create`: the run is recorded, and an agent's
  // run asks the user before it sends secrets. Always headless. The wait is
  // bounded like `runs.create`/`runs.wait`: a deadline or a disconnect never
  // cancels the run, and its page stays readable by runId.
  router.register("browser", "inspect", {
    input: inspectInput,
    output: BrowserInspectionSchema,
    handle: ({ workspaceId, waitMs, screenshot, maxBytes, scope, start, end, ...input }, context) =>
      deps.runs.inspectBrowser(
        workspaceId,
        {
          ...input,
          screenshot: screenshot ?? false,
          maxBytes: maxBytes ?? BROWSER_INSPECT_SNAPSHOT_DEFAULT_BYTES,
          ...(scope !== undefined ? { scope } : {}),
          ...(start !== undefined ? { start } : {}),
          ...(end !== undefined ? { end } : {}),
          waitMs: waitMs ?? RUN_WAIT_DEFAULT_MS,
        },
        {
          ...(context?.agent !== undefined ? { agent: context.agent } : {}),
          ...(context?.signal !== undefined ? { signal: context.signal } : {}),
        },
      ),
  })
}
