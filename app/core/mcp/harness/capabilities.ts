import { BUILTIN_AGENTS } from "@shared/agents/builtin-agents"
import type { McpClientCapability, McpClientCapabilityRow } from "./types"

const UNVERIFIED: McpClientCapability = "unverified"
const UNSUPPORTED: McpClientCapability = "unsupported"
const NOT_APPLICABLE: McpClientCapability = "not-applicable"

/**
 * A roster-complete evidence matrix. It captures declared wiring separately
 * from runtime verification so unavailable client tests cannot accidentally pass.
 */
export function createBuiltinClientCapabilityMatrix(): readonly McpClientCapabilityRow[] {
  return BUILTIN_AGENTS.map((agent) => {
    const mcpWiring = wiringFor(agent.agentKey)
    const capability = mcpWiring === "none" ? UNSUPPORTED : UNVERIFIED
    return {
      agentKey: agent.agentKey,
      agentName: agent.name,
      mcpWiring,
      testedVersion: null,
      connection: capability,
      resourceReading: capability,
      serverInstructions: capability,
      toolListHandling: capability,
      localReferenceSupport: capability,
      resultChannelHandling: capability,
      timeoutAndCancellation: capability,
      toolSearch: capability,
      modelVisibleTokens: mcpWiring === "none" ? NOT_APPLICABLE : UNVERIFIED,
    }
  })
}

function wiringFor(agentKey: string): McpClientCapabilityRow["mcpWiring"] {
  switch (agentKey) {
    case "claude":
    case "codex":
    case "gemini":
    case "opencode":
    case "copilot":
    case "qwen":
      return "per-launch"
    case "cursor-agent":
    case "crush":
      return "manual"
    case "aider":
    case "pi":
      return "none"
    default:
      throw new Error(`Unclassified built-in agent in MCP capability matrix: ${agentKey}`)
  }
}
