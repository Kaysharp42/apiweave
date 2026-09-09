import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { McpWorkflowWriteToolResultSchema, WorkflowDiagnosisSchema } from "@shared/zod-schemas"
import type { IpcRouter } from "../ipc/router"
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
    const outputValueSchema = spec.resultProjection === "run" ? z.unknown() : reg.output
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

async function dispatchAsTool(
  router: IpcRouter,
  spec: McpToolSpec,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<CallToolResult> {
  const payload = args ?? {}
  // MCP default: topology-aware auto-layout is on unless the caller opts out
  // with `layout: false`. The service itself defaults to preserving positions
  // (the renderer omits the key), so this default lives on the MCP transport —
  // the one caller that never reasons about canvas coordinates — while the
  // revision-aware layout decision lives in `WorkflowService` on the snapshot
  // being saved, never on a redacted or pre-dispatch copy.
  if (spec.autoLayout === true && payload["layout"] === undefined) {
    payload["layout"] = true
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
