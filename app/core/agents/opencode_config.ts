import type { McpClientConfig } from "@shared/types/McpClientConfig"
import { scratchFileKind, writeScratchFile } from "./scratch_files"

/**
 * The launcher-config scratch kind. Same lifetime rules as the MCP config and
 * the briefing beside it: one file per session, named for its session, dropped
 * by the terminal transition and reclaimed by the startup sweep. Unlike the
 * MCP config it holds the bearer token only until the session ends — same
 * `0o600`, same reasons.
 */
export const OPENCODE_CONFIG_SCRATCH = scratchFileKind("opencode-config-", ".json")

/**
 * Write one session's OpenCode launcher config and return its path.
 *
 * OpenCode is the roster's agent with no flags to carry anything: no
 * `--mcp-config`, no system-prompt flag. What it does have is `OPENCODE_CONFIG`,
 * an environment variable naming a config file it merges in between the user's
 * global and project configs — so this one file carries both halves at once:
 *
 * - `instructions` — the session briefing, by absolute path. Absolute because
 *   OpenCode resolves a *relative* instruction path against the project
 *   directory (the user's repository, where no briefing lives), not against
 *   the config file that names it.
 * - `mcp.apiweave` — the bridge, as a remote server with a bearer header. The
 *   same URL and token the Claude-format MCP config carries.
 *
 * OpenCode deep-merges config layers per server entry, so `enabled`, `url` and
 * `headers` are all written explicitly: a key left unset would leak in from
 * whatever `apiweave` entry the user's own config holds — most likely a stale
 * one from before this wiring existed, whose token died with the run that
 * wrote it. Set keys win; only harmless siblings survive the merge.
 *
 * Confirmed against opencode 1.18.21 with `opencode debug config`: the flat
 * `mcp: { <name>: { type, url, headers } }` shape parses (the nested
 * `mcp.servers` v2 shape does not), and `instructions` accepts an absolute
 * Windows path.
 */
export function writeOpenCodeSessionConfig(
  scratchDir: string,
  sessionId: string,
  briefingPath: string | null,
  mcp: McpClientConfig | null,
): string {
  const contents: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    ...(briefingPath === null ? {} : { instructions: [briefingPath] }),
    ...(mcp === null
      ? {}
      : {
          mcp: {
            apiweave: {
              enabled: true,
              type: "remote",
              url: mcp.url,
              headers: { Authorization: `Bearer ${mcp.token}` },
            },
          },
        }),
  }
  return writeScratchFile(
    scratchDir,
    OPENCODE_CONFIG_SCRATCH.filename(sessionId),
    `${JSON.stringify(contents, null, 2)}\n`,
    0o600,
  )
}

/**
 * Substitute the config's path into a definition's `configEnv` templates.
 *
 * The same `{path}` convention as `mcpConfigArgs` and `briefingArgs`, over a
 * record rather than an array because the deliverer here is a named
 * environment variable, not a flag at a position in argv.
 */
export function renderConfigEnv(
  template: Readonly<Record<string, string>>,
  configPath: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(template).map(([name, value]) => [name, value.replaceAll("{path}", configPath)]),
  )
}
