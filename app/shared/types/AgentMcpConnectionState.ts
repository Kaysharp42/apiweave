/**
 * Where one MCP client stands with APIWeave's stdio launcher:
 * - `connected` — its user config runs this install's launcher.
 * - `outdated` — it has an `apiweave` entry, but not this launcher (an old
 *   direct-HTTP entry, or a launcher path from another install). Connect replaces it.
 * - `not-connected` — it is installed and has no `apiweave` entry.
 * - `not-installed` — APIWeave found no sign of it on this machine.
 */
export type AgentMcpConnectionState = "connected" | "outdated" | "not-connected" | "not-installed"
