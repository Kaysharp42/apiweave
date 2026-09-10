import type { McpClientCapability } from "./McpClientCapability"

/** Declared wiring and observed-capability placeholders for one built-in agent. */
export interface McpClientCapabilityRow {
  readonly agentKey: string
  readonly agentName: string
  readonly mcpWiring: "per-launch" | "manual" | "none"
  readonly testedVersion: string | null
  readonly connection: McpClientCapability
  readonly resourceReading: McpClientCapability
  readonly serverInstructions: McpClientCapability
  readonly toolListHandling: McpClientCapability
  readonly localReferenceSupport: McpClientCapability
  readonly resultChannelHandling: McpClientCapability
  readonly timeoutAndCancellation: McpClientCapability
  readonly toolSearch: McpClientCapability
  readonly modelVisibleTokens: McpClientCapability
}
