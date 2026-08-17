import type { McpClientConfig } from "@shared/types/McpClientConfig"
import { scratchFileKind, writeScratchFile } from "./scratch_files"

/**
 * One config file per session, not one per app.
 *
 * A single fixed `apiweave.json` was a live-token hazard twice over. Two
 * sessions launched at once raced on the same path, so the second launch
 * rewrote the token the first one had already been handed — and since the
 * bridge mints a fresh token per run, the first agent's config could stop
 * authenticating mid-session. Worse, one shared file has no owner, so nothing
 * could ever delete it: a bearer token good for every whitelisted MCP tool sat
 * in userData until the next launch overwrote it.
 *
 * Keying the name on the session id gives the file exactly one owner and one
 * lifetime, which is what makes {@link MCP_CONFIG_SCRATCH.deleteOne} and the
 * startup {@link MCP_CONFIG_SCRATCH.sweep} possible at all.
 */
export const MCP_CONFIG_SCRATCH = scratchFileKind("apiweave-mcp-", ".json")

/**
 * Write the MCP config a launched agent is pointed at, and return its path.
 *
 * The obvious implementation of "wire up MCP" is to drop an `.mcp.json` into
 * the working directory. That directory is a git repository, and the file holds
 * a bearer token good for every whitelisted MCP tool — so it goes into
 * APIWeave's own userData instead, and the agent is given the path. The token
 * stays out of argv too, where any process listing on the machine could read
 * it.
 *
 * `0o600` on POSIX for the same reason. Windows has no chmod equivalent worth
 * emulating here; userData is already per-user there.
 */
export function writeAgentMcpConfig(configDir: string, config: McpClientConfig, sessionId: string): string {
  const contents = {
    mcpServers: {
      apiweave: {
        type: "http",
        url: config.url,
        headers: { Authorization: `Bearer ${config.token}` },
      },
    },
  }
  return writeScratchFile(
    configDir,
    MCP_CONFIG_SCRATCH.filename(sessionId),
    `${JSON.stringify(contents, null, 2)}\n`,
    0o600,
  )
}

/**
 * Substitute the concrete config path into a definition's `mcpConfigArgs`
 * template, replacing every `{path}` occurrence.
 *
 * One template syntax for both spellings the world uses: `--mcp-config {path}`
 * fills a path into its own argument, `--mcp-config={path}` splices it into an
 * existing one. No shell is involved on either side — this is argv composition.
 */
export function renderMcpConfigArgs(template: readonly string[], configPath: string): readonly string[] {
  return template.map((argument) => argument.replaceAll("{path}", configPath))
}
