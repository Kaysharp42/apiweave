import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js"
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from "@modelcontextprotocol/sdk/types.js"

/** The SDK's UriTemplate variable bag (Record<string, string | string[]>). */
type Variables = Record<string, string | string[]>
import type { IpcRouter } from "../ipc/router"
import type { RunEventBroker } from "../runner/run_event_broker"
import { projectRunSnapshot } from "./run-projection"

/**
 * MCP resources — read-only, safe run snapshots the agent can pull for context
 * (plan §4.3). Like tools, a resource read dispatches through the shared IPC
 * router (`runs.get`) with `redactSecrets` on, so authorization and
 * secret-safety are inherited from the service path, not re-implemented. The
 * projection is metadata-only; no bodies/headers/cookies/URLs/values cross MCP.
 *
 * When a {@link RunEventBroker} is supplied (Phase 6), the server advertises
 * resource-subscription capability: a client `resources/subscribe` on a run URI
 * registers a broker listener that fires `notifications/resources/updated` for
 * that exact URI on each run transition. The notification is a change signal —
 * the client re-reads the resource (which now reports a newer `latestSequence`).
 * Without a broker the template still works as a poll-only read.
 */
export const RUN_RESOURCE_URI_TEMPLATE = "apiweave://workspaces/{workspaceId}/runs/{runId}"

const RUN_RESOURCE_NAME = "run-snapshot"
const RUN_RESOURCE_DESCRIPTION =
  "A safe, current snapshot of one workflow run: status, timing, and per-node status/statusCode. Metadata only — never response bodies, headers, cookies, URLs, or secret values."

/** Inventory for the setup control plane / MCPManager. Mirrors MCP_TOOLS/MCP_PROMPTS. */
export const MCP_RESOURCES: readonly { name: string; uriTemplate: string; description: string }[] = [
  { name: RUN_RESOURCE_NAME, uriTemplate: RUN_RESOURCE_URI_TEMPLATE, description: RUN_RESOURCE_DESCRIPTION },
]

export function registerResources(server: McpServer, router: IpcRouter, broker?: RunEventBroker): void {
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

      const snapshot = projectRunSnapshot(result.data, broker?.getLatestSequence(runId) ?? 0)
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(snapshot, null, 2) }],
      }
    },
  )

  if (broker) registerRunSubscriptions(server, broker)
}

/**
 * Wire true resource subscriptions for run URIs against the broker. One live
 * MCP session owns one server, so subscription state and cleanup are per
 * session — isolated from every other session by construction.
 */
function registerRunSubscriptions(server: McpServer, broker: RunEventBroker): void {
  const low = server.server
  low.registerCapabilities({ resources: { subscribe: true } })

  // uri -> broker unsubscribe, so a duplicate subscribe is idempotent and every
  // subscription is torn down on unsubscribe or session close (no listener leak).
  const unsubByUri = new Map<string, () => void>()

  low.setRequestHandler(SubscribeRequestSchema, (request) => {
    const uri = request.params.uri
    const runId = runIdFromUri(uri)
    if (runId !== null && !unsubByUri.has(uri)) {
      const unsub = broker.subscribe((event) => {
        if (event.runId !== runId) return
        // Fire-and-forget: the notification is only a change signal; the client
        // re-reads the resource for the newer snapshot/sequence.
        // ponytail: no explicit outbound-notification queue/cap — the volume is
        // naturally bounded by run transitions (≈ node count per run) and the
        // SDK's SSE stream handles write buffering. Add coalescing only if a
        // pathological workflow floods a slow client.
        void low.sendResourceUpdated({ uri })
      })
      unsubByUri.set(uri, unsub)
    }
    return {}
  })

  low.setRequestHandler(UnsubscribeRequestSchema, (request) => {
    const uri = request.params.uri
    unsubByUri.get(uri)?.()
    unsubByUri.delete(uri)
    return {}
  })

  const priorOnClose = low.onclose
  low.onclose = () => {
    for (const unsub of unsubByUri.values()) unsub()
    unsubByUri.clear()
    priorOnClose?.()
  }
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

/** Extract the runId from a concrete run URI, or null if it isn't one (a
 * subscribe to an unrelated URI is silently a no-op rather than an error). */
function runIdFromUri(uri: string): string | null {
  const match = /^apiweave:\/\/workspaces\/[^/]+\/runs\/([^/]+)$/.exec(uri)
  const runId = match?.[1]
  if (runId === undefined || runId.length === 0) return null
  try {
    return decodeURIComponent(runId)
  } catch {
    return null
  }
}

function single(value: string | string[] | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) return null
  return value
}
