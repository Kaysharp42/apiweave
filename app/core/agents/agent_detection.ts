import { execFile } from "node:child_process"
import type { AgentAvailability } from "@shared/types/AgentAvailability"
import type { AgentDefinition } from "@shared/types/AgentDefinition"
import { AgentAvailabilitySchema } from "@shared/zod-schemas/AgentAvailabilitySchema"
import { resolveExecutable, spawnCommandFor } from "./executable"

/** A hung `--version` must not hang the roster; every agent gets its own budget. */
const PROBE_TIMEOUT_MS = 5_000

/**
 * Three states, because presence on PATH is not the same as working.
 *
 * Measured on a real machine: `opencode` resolves on PATH to a `.cmd` shim and
 * then fails every invocation with "opencode-ai's postinstall script was not
 * run". A roster that only checked presence would show it as available and
 * launch a dead process, and the user would have no idea why. So `ready`
 * requires the probe to succeed too, and `broken` carries the failure text
 * straight into the UI where it can be acted on.
 *
 * Every return goes through `AgentAvailabilitySchema`. This is the one place an
 * availability row is *manufactured* — half of it out of a child process's
 * stderr — and it crosses IPC untouched from here, so the schema that defines
 * the contract is the thing that decides whether a row satisfies it. Once per
 * probe, next to a `spawn`: the cost does not register.
 */
export async function detectAgent(
  definition: AgentDefinition,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentAvailability> {
  const checkedAt = Date.now()

  if (definition.unsupportedPlatforms.includes(process.platform)) {
    return AgentAvailabilitySchema.parse({
      agentKey: definition.agentKey,
      state: "unsupported",
      resolvedPath: null,
      detail: `Not supported on ${process.platform}`,
      checkedAt,
    })
  }

  const resolvedPath = resolveExecutable(definition.detectCmd, env)
  if (resolvedPath === undefined) {
    return AgentAvailabilitySchema.parse({
      agentKey: definition.agentKey,
      state: "not-found",
      resolvedPath: null,
      detail: `${definition.detectCmd} was not found on PATH`,
      checkedAt,
    })
  }

  const probe = await probeVersion(resolvedPath, env)
  return AgentAvailabilitySchema.parse({
    agentKey: definition.agentKey,
    state: probe.ok ? "ready" : "broken",
    resolvedPath,
    detail: probe.detail,
    checkedAt,
  })
}

export async function detectAgents(
  definitions: readonly AgentDefinition[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<readonly AgentAvailability[]> {
  return Promise.all(definitions.map((definition) => detectAgent(definition, env)))
}

interface ProbeResult {
  readonly ok: boolean
  readonly detail: string
}

/**
 * `--version` is the one flag every agent in the roster accepts, it exits
 * immediately, and it needs neither auth nor a project directory — which makes
 * it the only probe that distinguishes "installed and working" from "installed
 * and broken" without side effects.
 */
function probeVersion(executablePath: string, env: NodeJS.ProcessEnv): Promise<ProbeResult> {
  const command = spawnCommandFor(executablePath, ["--version"], env)
  return new Promise((resolve) => {
    execFile(
      command.file,
      [...command.args],
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true, env },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ ok: true, detail: firstLine(stdout) || firstLine(stderr) || "installed" })
          return
        }
        // A broken install usually explains itself on stderr — surface that
        // verbatim rather than a generic "exited with code 1".
        resolve({ ok: false, detail: firstLine(stderr) || firstLine(stdout) || error.message })
      },
    )
  })
}

function firstLine(output: string): string {
  return output.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? ""
}
