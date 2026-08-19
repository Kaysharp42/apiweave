import { z } from "zod"

/**
 * Three states, not two — presence on PATH is not the same as working.
 *
 * Measured on a real machine: `opencode` resolves on PATH to a `.cmd` shim and
 * then fails every invocation with "opencode-ai's postinstall script was not
 * run". A roster that only checks presence shows it as available and launches a
 * dead process. So `ready` requires a resolved path AND a successful `--version`
 * probe, and `broken` carries the probe's stderr so the user can fix it.
 */
export const AgentAvailabilityStateSchema = z.enum(["not-found", "ready", "broken", "unsupported"])

export const AgentAvailabilitySchema = z
  .object({
    agentKey: z.string().min(1),
    state: AgentAvailabilityStateSchema,
    /** Absolute path the binary resolved to, when it resolved at all. */
    resolvedPath: z.string().nullable().optional(),
    /** First line of `--version` output on `ready`, the failure on `broken`. */
    detail: z.string().nullable().optional(),
    checkedAt: z.number().int().nonnegative(),
  })
  .strict()
