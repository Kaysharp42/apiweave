import type { McpClientConfig } from "@shared/types/McpClientConfig"
import type { AgentDefinition } from "@shared/types/AgentDefinition"
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

/** The JSON shapes `writeAgentMcpConfig` can emit; see the schema's field. */
export type McpConfigFormat = NonNullable<AgentDefinition["mcpConfigFormat"]>

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
export function writeAgentMcpConfig(
  configDir: string,
  config: McpClientConfig,
  sessionId: string,
  format: McpConfigFormat = "claude",
): string {
  const server =
    format === "qwen"
      ? // Qwen's `--mcp-config` takes field-based transport keys: `httpUrl` is
        // the streamable-HTTP one, and a bare `url` there means SSE. Its Claude
        // normalization is applied to `.mcp.json` files only, not to this flag,
        // so the Claude shape would connect with the wrong transport.
        { httpUrl: config.url, headers: { Authorization: `Bearer ${config.token}` } }
      : { type: "http", url: config.url, headers: { Authorization: `Bearer ${config.token}` } }
  const contents = { mcpServers: { apiweave: server } }
  return writeScratchFile(
    configDir,
    MCP_CONFIG_SCRATCH.filename(sessionId),
    `${JSON.stringify(contents, null, 2)}\n`,
    0o600,
  )
}

/**
 * Substitute the config's concrete location and URL into a definition's
 * `mcpConfigArgs` template, replacing every `{path}` and `{url}` occurrence.
 *
 * One template syntax for all the spellings the world uses: `--mcp-config
 * {path}` fills a path into its own argument, `--additional-mcp-config=@{path}`
 * splices it into an existing one, and `-c mcp_servers.apiweave.url={url}`
 * carries only the URL — no quotes needed, because Codex's value parser falls
 * back to a raw string when the right-hand side is not valid TOML, and an
 * unquoted value is the one form that survives `cmd.exe` untouched. No shell
 * is involved on any side — this is argv composition.
 */
export function renderMcpConfigArgs(template: readonly string[], configPath: string, config: McpClientConfig): readonly string[] {
  return template.map((argument) =>
    argument.replaceAll("{path}", configPath).replaceAll("{url}", config.url),
  )
}

/**
 * Substitute into a definition's `mcpConfigEnv` templates: `{path}` for the
 * generated config file, `{token}` for the bridge's bearer token.
 *
 * The token rides in a variable and never in argv — see
 * {@link writeAgentMcpConfig} for why, and the schema's field for which CLIs
 * need which half.
 */
export function renderMcpConfigEnv(
  template: Readonly<Record<string, string>>,
  configPath: string,
  config: McpClientConfig,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(template).map(([name, value]) => [
      name,
      value.replaceAll("{path}", configPath).replaceAll("{token}", config.token),
    ]),
  )
}

/**
 * Whether any template names the generated file, and therefore whether writing
 * one is part of the launch. Codex's argv-only wiring references neither, and
 * writing a config file nobody reads would be scratch with no reader — plus
 * one more file whose deletion lifecycle has to be correct for nothing.
 */
export function templatesReferencePath(
  args: readonly string[],
  env: Readonly<Record<string, string>>,
): boolean {
  return (
    args.some((argument) => argument.includes("{path}")) ||
    Object.values(env).some((value) => value.includes("{path}"))
  )
}
