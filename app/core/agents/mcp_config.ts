import fs from "node:fs"
import path from "node:path"
import type { McpClientConfig } from "@shared/types/McpClientConfig"

/** File name written inside the caller-supplied directory. */
export const AGENT_MCP_CONFIG_FILENAME = "apiweave.json"

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
export function writeAgentMcpConfig(configDir: string, config: McpClientConfig): string {
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 })
  const filePath = path.join(configDir, AGENT_MCP_CONFIG_FILENAME)
  const contents = {
    mcpServers: {
      apiweave: {
        type: "http",
        url: config.url,
        headers: { Authorization: `Bearer ${config.token}` },
      },
    },
  }
  fs.writeFileSync(filePath, `${JSON.stringify(contents, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  return filePath
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
