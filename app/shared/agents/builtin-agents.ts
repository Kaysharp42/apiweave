import type { AgentDefinition } from "../types/AgentDefinition"

/**
 * The built-in agent roster.
 *
 * Every entry is a CLI the *user* has installed and authenticated themselves —
 * APIWeave launches it under their own credentials and never proxies, bundles,
 * or re-sells access to any of them. That is also why the roster is a plain
 * data table: adding an agent is a row, not code.
 *
 * `mcpConfigArgs` is deliberately conservative. It is set only where the flags
 * have actually been confirmed against an installed CLI, because a wrong
 * template produces an agent that refuses to start with an unknown-flag error,
 * which is a much worse failure than simply not auto-wiring MCP. Agents left
 * at an empty array still launch in the right directory; their MCP config stays
 * a manual step via the templates in `mcp-configs/`.
 */
export const BUILTIN_AGENTS: readonly AgentDefinition[] = [
  {
    agentKey: "claude",
    name: "Claude Code",
    detectCmd: "claude",
    argv: [],
    expectedProcess: "claude",
    env: {},
    promptMode: "argv",
    promptFlag: null,
    // Confirmed against CLI 2.1.226: `--mcp-config <path|json>` and
    // `--strict-mcp-config` (restricts the session to only the named servers).
    mcpConfigArgs: ["--mcp-config", "{path}", "--strict-mcp-config"],
    unsupportedPlatforms: [],
    installUrl: "https://docs.claude.com/en/docs/claude-code/overview",
  },
  {
    agentKey: "codex",
    name: "Codex CLI",
    detectCmd: "codex",
    argv: [],
    expectedProcess: "codex",
    env: {},
    promptMode: "argv",
    promptFlag: null,
    mcpConfigArgs: [],
    unsupportedPlatforms: [],
    installUrl: "https://github.com/openai/codex",
  },
  {
    agentKey: "gemini",
    name: "Gemini CLI",
    detectCmd: "gemini",
    argv: [],
    expectedProcess: "gemini",
    env: {},
    promptMode: "argv",
    promptFlag: null,
    mcpConfigArgs: [],
    unsupportedPlatforms: [],
    installUrl: "https://github.com/google-gemini/gemini-cli",
  },
  {
    agentKey: "opencode",
    name: "OpenCode",
    detectCmd: "opencode",
    argv: [],
    expectedProcess: "opencode",
    env: {},
    promptMode: "argv",
    promptFlag: null,
    mcpConfigArgs: [],
    unsupportedPlatforms: [],
    installUrl: "https://opencode.ai",
  },
  {
    agentKey: "cursor-agent",
    name: "Cursor Agent",
    detectCmd: "cursor-agent",
    argv: [],
    expectedProcess: "cursor-agent",
    env: {},
    promptMode: "argv",
    promptFlag: null,
    mcpConfigArgs: [],
    unsupportedPlatforms: [],
    installUrl: "https://cursor.com/cli",
  },
  {
    agentKey: "aider",
    name: "Aider",
    detectCmd: "aider",
    argv: [],
    expectedProcess: "aider",
    env: {},
    promptMode: "flag",
    promptFlag: "--message",
    mcpConfigArgs: [],
    unsupportedPlatforms: [],
    installUrl: "https://aider.chat",
  },
]

export const DEFAULT_AGENT_KEY = "claude"

export function findBuiltinAgent(agentKey: string): AgentDefinition | undefined {
  return BUILTIN_AGENTS.find((agent) => agent.agentKey === agentKey)
}
