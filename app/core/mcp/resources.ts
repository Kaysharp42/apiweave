import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js"

/** The SDK's UriTemplate variable bag (Record<string, string | string[]>). */
type Variables = Record<string, string | string[]>
import type { IpcRouter } from "../ipc/router"
import { projectRunSnapshot } from "./run-projection"

/**
 * MCP resources — read-only, safe run snapshots the agent can pull for context
 * (plan §4.3 step 1). Like tools, a resource read dispatches through the shared
 * IPC router (`runs.get`) with `redactSecrets` on, so authorization and
 * secret-safety are inherited from the service path, not re-implemented. The
 * projection is metadata-only; no bodies/headers/cookies/URLs/values cross MCP.
 *
 * ponytail: template only, no subscription/notification capability yet — that
 * needs the run event broker and sessionful transport (Phase 6). A client polls
 * the read as documented until then.
 */
export const RUN_RESOURCE_URI_TEMPLATE = "apiweave://workspaces/{workspaceId}/runs/{runId}"

const RUN_RESOURCE_NAME = "run-snapshot"
const RUN_RESOURCE_DESCRIPTION =
  "A safe, current snapshot of one workflow run: status, timing, and per-node status/statusCode. Metadata only — never response bodies, headers, cookies, URLs, or secret values."

/** Inventory for the setup control plane / MCPManager. Mirrors MCP_TOOLS/MCP_PROMPTS. */
export const MCP_RESOURCES: readonly { name: string; uriTemplate: string; description: string }[] = [
  { name: RUN_RESOURCE_NAME, uriTemplate: RUN_RESOURCE_URI_TEMPLATE, description: RUN_RESOURCE_DESCRIPTION },
]

export function registerResources(server: McpServer, router: IpcRouter): void {
  server.registerResource(
    RUN_RESOURCE_NAME,
    // `list: undefined` → discoverable via resources/templates/list, not enumerated
    // as concrete resources (we can't list every run without a workspace/workflow).
    new ResourceTemplate(RUN_RESOURCE_URI_TEMPLATE, { list: undefined }),
    { description: RUN_RESOURCE_DESCRIPTION, mimeType: "application/json" },
    async (uri, variables): Promise<ReadResourceResult> => {
      const { workspaceId, runId } = decodeRunUriVars(variables)
      const result = await router.dispatch(
        { domain: "runs", action: "get", payload: { workspaceId, runId } },
        { redactSecrets: true },
      )
      // Existence-hiding: any authorization/lookup failure surfaces as the router's
      // error (not_found for cross-workspace/unknown runs), never a partial read.
      if (!result.ok) throw new Error(`Error [${result.error.code}]: ${result.error.message}`)

      const snapshot = projectRunSnapshot(result.data)
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(snapshot, null, 2) }],
      }
    },
  )
}

/** The SDK's UriTemplate already percent-decodes on extraction; we only reject
 * missing/array values so a malformed URI can't reach the router as undefined. */
function decodeRunUriVars(variables: Variables): { workspaceId: string; runId: string } {
  const workspaceId = single(variables["workspaceId"])
  const runId = single(variables["runId"])
  if (workspaceId === null || runId === null) {
    throw new Error("Error [validation]: run resource URI requires workspaceId and runId")
  }
  return { workspaceId, runId }
}

function single(value: string | string[] | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) return null
  return value
}
