import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import {
  McpWorkflowWriteToolResultSchema,
  WorkflowDebugContextSchema,
  WorkflowDiagnosisSchema,
  WorkflowNodesViewSchema,
  WorkflowOutlineViewSchema,
  WorkflowSchema,
} from "@shared/zod-schemas"
import type { IpcRouter } from "../ipc/router"
import { RUN_WAIT_DEFAULT_MS } from "../services/read_budgets"
import { projectRunToolResult } from "./run-projection"
import { MCP_TOOLS, toolAnnotations, toolName, type McpToolSpec } from "./tools"
import { encodeMcpResult } from "./result-encoding"
import { projectMcpError } from "./error-projection"
import {
  compactWorkflowDiagnosis,
  projectWorkflowWrite,
  unavailableWorkflowDiagnosis,
  workflowIdentity,
} from "./projections/workflow-write"

/**
 * A stored node object, advertised without the ~22 KB `WorkflowNodeSchema`
 * discriminated union.
 *
 * MCP output schemas are optional (spec 2025-11-25), and a looser advertisement
 * is always satisfied by the stricter data — the router still validates every
 * response against the real `WorkflowGetViewSchema` / `WorkflowDebugContextSchema`
 * on the shared IPC path, so nothing about validation strength or the bytes an
 * agent receives changes. What changes is that the node union is advertised
 * ONCE, on the write tools' *input* schemas (`workflows_create/update/patch`),
 * which is where it is actually enforced and where an agent has to read it
 * anyway to author a node.
 */
const AdvertisedNodeSchema = z.record(z.string(), z.unknown())

/**
 * MCP-only output advertisements for the two reads whose schemas re-embedded
 * the node union a second and third time. Keyed by public tool name.
 */
const ADVERTISED_OUTPUT: ReadonlyMap<string, z.ZodTypeAny> = new Map<string, z.ZodTypeAny>([
  // `full` is the whole stored graph — everything but node internals stays
  // typed. `outline` and `nodes` keep their exact schemas, so the partial-read
  // markers (`view`, `partial: true`) stay advertised and enforced.
  [
    "workflows_get",
    z.union([
      WorkflowOutlineViewSchema,
      WorkflowNodesViewSchema,
      WorkflowSchema.extend({ nodes: z.array(AdvertisedNodeSchema) }),
    ]),
  ],
  ["workflows_debugContext", WorkflowDebugContextSchema.extend({ nodes: z.array(AdvertisedNodeSchema) })],
])

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

    // Pass the complete object: rebuilding from `.shape` loses strictness and
    // lets the SDK strip unknown keys before the router can reject them.
    // NoInput is an optional empty object; MCP supplies an argument object.
    const inputSchema = reg.input instanceof z.ZodObject ? reg.input : z.object({}).strict()
    const outputValueSchema = spec.resultProjection === "run"
      ? z.unknown()
      : ADVERTISED_OUTPUT.get(toolName(spec)) ?? reg.output
    const outputSchema = spec.resultProjection === "workflowWrite"
      ? McpWorkflowWriteToolResultSchema
      : z.object({ result: outputValueSchema })

    server.registerTool(
      toolName(spec),
      {
        description: spec.description,
        inputSchema,
        outputSchema,
        annotations: toolAnnotations(spec),
      },
      (args: Record<string, unknown>, extra?: { readonly signal?: AbortSignal }) =>
        dispatchAsTool(router, spec, args, extra?.signal),
    )
  }
}

// fallow-ignore-next-line complexity
async function dispatchAsTool(
  router: IpcRouter,
  spec: McpToolSpec,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<CallToolResult> {
  // Copy: the SDK owns `args`, and the defaults below must not write into it.
  const payload = { ...args }
  // MCP default: topology-aware auto-layout is on unless the caller opts out
  // with `layout: false`. The service itself defaults to preserving positions
  // (the renderer omits the key), so this default lives on the MCP transport —
  // the one caller that never reasons about canvas coordinates — while the
  // revision-aware layout decision lives in `WorkflowService` on the snapshot
  // being saved, never on a redacted or pre-dispatch copy.
  if (spec.autoLayout === true && payload["layout"] === undefined) {
    payload["layout"] = true
  }
  // MCP default: `runs_create` waits up to 10s so an agent gets the outcome in
  // one call. Same reasoning as `layout` above — the service (and therefore the
  // renderer, which observes runs over the per-run progress topic) defaults to
  // returning the queued snapshot immediately, so this agent-facing policy
  // lives on the MCP transport, never on the shared IPC handler.
  if (spec.domain === "runs" && spec.action === "create" && payload["waitMs"] === undefined) {
    payload["waitMs"] = RUN_WAIT_DEFAULT_MS
  }

  let result
  try {
    result = await router.dispatch(
      { domain: spec.domain, action: spec.action, payload },
      { redactSecrets: true, ...(signal !== undefined ? { signal } : {}) },
    )
  } catch (error) {
    // A cancelled wait is client-side cancellation (disconnect, explicit cancel,
    // host teardown): the run keeps going, only the observation stops. Re-throw
    // so the SDK drops the response instead of sending an error for a gone client.
    // Never confuse this with runs_cancel, which stops the run itself.
    if (error instanceof Error && error.name === "AbortError") throw error
    // dispatch re-throws genuine internal bugs (HTTP-500 equivalent). Surface a
    // generic error to the client rather than leaking internals over the wire.
    return { content: [{ type: "text", text: "internal error" }], isError: true }
  }

  if (result.ok) {
    // The write landed, so tell the renderer something in this domain moved.
    // Only `WorkflowRepository` broadcasts its own changes, and only the tool
    // whitelist knows an action is a write — so this is the one place that can
    // announce an agent's write to any other repository. See
    // `AGENT_WRITE_CHANNEL`. Emitted before the response is shaped: a
    // projection or diagnosis failure must not swallow a change that is
    // already durable.
    if (spec.intent === "write") {
      const workspaceId = payload["workspaceId"]
      router.notifyAgentWrite({
        domain: spec.domain,
        action: spec.action,
        ...(typeof workspaceId === "string" ? { workspaceId } : {}),
      })
    }
    if (spec.resultProjection === "workflowWrite") {
      const projected = projectWorkflowWrite(spec, payload, result.data)
      if (projected === undefined) {
        return { content: [{ type: "text", text: "internal error" }], isError: true }
      }
      const response = {
        result: projected,
        diagnosis: await diagnoseWritten(router, result.data, payload),
      }
      return {
        content: [{ type: "text", text: encodeMcpResult(response) }],
        structuredContent: response,
      }
    }
    const data = spec.resultProjection === "run" ? projectRunToolResult(result.data) : result.data
    return {
      content: [{ type: "text", text: encodeMcpResult(data) }],
      structuredContent: { result: data },
    }
  }
  const error = projectMcpError(result.error.code, result.error.message, result.error.details)
  return {
    content: [{ type: "text", text: encodeMcpResult({ error }) }],
    isError: true,
  }
}

/**
 * Diagnose the persisted graph once, after a graph write. A failed analysis does
 * not turn a durable write into an error, but it is explicitly unavailable — it
 * must never look like a clean graph.
 */
async function diagnoseWritten(
  router: IpcRouter,
  written: unknown,
  payload: Record<string, unknown>,
) {
  const identity = workflowIdentity(written, payload)
  if (identity === undefined) return unavailableWorkflowDiagnosis()
  try {
    const result = await router.dispatch(
      { domain: "workflows", action: "diagnose", payload: identity },
      { redactSecrets: true },
    )
    if (!result.ok) return unavailableWorkflowDiagnosis()
    const diagnosis = WorkflowDiagnosisSchema.safeParse(result.data)
    return diagnosis.success ? compactWorkflowDiagnosis(diagnosis.data) : unavailableWorkflowDiagnosis()
  } catch {
    return unavailableWorkflowDiagnosis()
  }
}
