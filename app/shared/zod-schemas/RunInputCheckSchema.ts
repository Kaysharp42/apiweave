import { z } from "zod"

/** One step that reads a missing value — in the workflow being run, or in one it calls. */
export const RunInputUseSchema = z
  .object({
    workflowId: z.string().min(1),
    workflowName: z.string(),
    nodeId: z.string().min(1),
    nodeLabel: z.string(),
  })
  .strict()

/**
 * A `{{env.NAME}}` or `{{secrets.NAME}}` a run would read without a usable
 * value: `unset` when nothing defines it, `empty` when what defines it is
 * blank. `storedIn` is the scope an empty secret was found in — the one to
 * give it a value in — and null otherwise. Names only: a check never returns
 * a value.
 */
export const MissingRunInputSchema = z
  .object({
    kind: z.enum(["env", "secret"]),
    name: z.string().min(1),
    reason: z.enum(["unset", "empty"]),
    storedIn: z.enum(["environment", "workspace"]).nullable(),
    usedBy: z.array(RunInputUseSchema),
  })
  .strict()

/**
 * What a run of a workflow would read that has no value, found before
 * anything is sent. `environment` is the one the run would use — the
 * request's, else the workflow's saved one — or null when it runs with none.
 */
export const RunInputCheckSchema = z
  .object({
    workspaceId: z.string().min(1),
    workflowId: z.string().min(1),
    workflowName: z.string(),
    environment: z.object({ environmentId: z.string().min(1), name: z.string() }).strict().nullable(),
    missing: z.array(MissingRunInputSchema),
  })
  .strict()

/**
 * A run refused for missing values: a workflow run (one check), or a project
 * run (one check per workflow that lacks something, in run order).
 */
export const RunInputsRefusalSchema = z
  .object({
    target: z.object({ kind: z.enum(["workflow", "project"]), name: z.string() }).strict(),
    checks: z.array(RunInputCheckSchema).min(1),
  })
  .strict()
