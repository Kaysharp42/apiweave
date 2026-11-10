import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { McpLauncher } from "./launcher"

// Entry point of apiweave-mcp.cjs, the command an agent's MCP config runs
// (`node <user data>/apiweave-mcp.cjs`). The app copies this bundle into its
// user-data folder, beside the token, catalog and launch command it reads.
// stdout is the protocol: nothing else may write to it.
const launcher = new McpLauncher({ agent: new StdioServerTransport(), dataDir: __dirname })

// The SDK's stdio transport does not notice the agent going away; the open app
// session would then keep this process alive for ever. Let the event loop drain
// rather than calling process.exit at once: on Windows, exiting while stdin's
// pipe is still closing aborts Node with a libuv assertion. The fallback timer
// is unref'd, so it only fires if something (a keep-alive socket) lingers.
let stopping = false
const stop = (): void => {
  if (stopping) return
  stopping = true
  void launcher.close().finally(() => {
    process.exitCode = 0
    setTimeout(() => process.exit(0), 2000).unref()
  })
}
process.stdin.once("end", stop)
process.once("SIGTERM", stop)
process.once("SIGINT", stop)

launcher.start().catch((error: unknown) => {
  process.stderr.write(`apiweave-mcp: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
