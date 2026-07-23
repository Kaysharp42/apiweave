import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { ZodRawShape } from "zod"
import type { IpcRouter } from "../ipc/router"
import { MCP_TOOLS, toolName, type McpToolSpec } from "./tools"

/**
 * Register every whitelisted IPC handler as an MCP tool on `server`. Each tool
 * dispatches through `router.dispatch` — the *same* validate → authorize → service
 * → validate path the renderer uses — so MCP is a second transport over the one
 * registry, not a parallel hand-ported stack. Parity and no-secret-leak hold by
 * construction (identical code path), not by a fixture-matched test.
 */
export function registerBridgeTools(server: McpServer, router: IpcRouter): void {
  for (const spec of MCP_TOOLS) {
    const reg = router.getRegistration(spec.domain, spec.action)
    if (reg === undefined) {
      // A whitelist entry with no handler is a wiring bug — fail loud at startup,
      // never silently drop a tool the operator expected to be there.
      throw new Error(`MCP whitelist references unknown handler: ${spec.domain}.${spec.action}`)
    }

    // The SDK builds the tool's JSON argument schema from a Zod raw shape. Our
    // inputs are `.strict()` ZodObjects; NoInput (optional empty object) has no
    // shape, so a zero-arg tool gets an empty shape.
    const inputSchema: ZodRawShape = reg.input instanceof z.ZodObject ? reg.input.shape : {}

    server.registerTool(
      toolName(spec),
      { description: spec.description, inputSchema },
      (args: Record<string, unknown>) => dispatchAsTool(router, spec, args),
    )
  }
}

async function dispatchAsTool(
  router: IpcRouter,
  spec: McpToolSpec,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  let result
  try {
    result = await router.dispatch(
      { domain: spec.domain, action: spec.action, payload: args ?? {} },
      { redactSecrets: true },
    )
  } catch {
    // dispatch re-throws genuine internal bugs (HTTP-500 equivalent). Surface a
    // generic error to the client rather than leaking internals over the wire.
    return { content: [{ type: "text", text: "internal error" }], isError: true }
  }

  if (result.ok) {
    return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] }
  }
  return {
    content: [{ type: "text", text: `Error [${result.error.code}]: ${result.error.message}` }],
    isError: true,
  }
}
