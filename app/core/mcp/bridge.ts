import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { ZodRawShape } from "zod"
import { WorkflowDiagnosisSchema } from "@shared/zod-schemas"
import type { Workflow } from "@shared/types/Workflow"
import { layoutWorkflowNodes } from "@shared/layout/workflowLayout"
import { mergeGraphPatch, type WorkflowGraphPatch } from "../services"
import type { IpcRouter } from "../ipc/router"
import { projectRunToolResult } from "./run-projection"
import { MCP_TOOLS, toolAnnotations, toolName, type McpToolSpec } from "./tools"

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
    const outputValueSchema = spec.resultProjection === "run" ? z.unknown() : reg.output
    // `result` stays byte-identical to the IPC response so parity holds; the
    // diagnosis rides alongside it as a sibling key.
    const outputSchema = spec.diagnoseAfterWrite === true
      ? z.object({ result: outputValueSchema, diagnosis: WorkflowDiagnosisSchema.optional() })
      : z.object({ result: outputValueSchema })

    server.registerTool(
      toolName(spec),
      {
        description: spec.description,
        inputSchema,
        outputSchema,
        annotations: toolAnnotations(spec),
      },
      (args: Record<string, unknown>) => dispatchAsTool(router, spec, args),
    )
  }
}

async function dispatchAsTool(
  router: IpcRouter,
  spec: McpToolSpec,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const payload = args ?? {}
  await applyAutoLayout(router, spec, payload)

  let result
  try {
    result = await router.dispatch(
      { domain: spec.domain, action: spec.action, payload },
      { redactSecrets: true },
    )
  } catch {
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
    const data = spec.resultProjection === "run" ? projectRunToolResult(result.data) : result.data
    const { result: envelopeResult, diagnosis } = await splitDiagnosis(router, spec, data)
    if (diagnosis === undefined) {
      // Graph-writing tools whose `result` does not carry a `workspaceId` (the
      // compact summary/diagnosis projections, or any write whose re-diagnosis
      // failed) cannot be re-diagnosed here — but they still ride inside the
      // same `{ result }` envelope the wrapped case uses, so every write tool's
      // text content is shape-stable across response sizes. Non-write tools
      // keep the bare-handler text they always had (`structuredContent` still
      // carries the `result` key).
      const text = spec.diagnoseAfterWrite === true
        ? JSON.stringify({ result: envelopeResult }, null, 2)
        : JSON.stringify(envelopeResult, null, 2)
      return {
        content: [{ type: "text", text }],
        structuredContent: { result: envelopeResult },
      }
    }
    // Only the graph-writing tools take this branch, and only they carry the
    // wrapper in their text content: a client that reads text and ignores
    // structuredContent still has to see the diagnosis, or attaching it would
    // achieve nothing. Every other tool's text stays the bare handler response.
    return {
      content: [{ type: "text", text: JSON.stringify({ result: envelopeResult, diagnosis }, null, 2) }],
      structuredContent: { result: envelopeResult, diagnosis },
    }
  }
  return {
    content: [{ type: "text", text: `Error [${result.error.code}]: ${result.error.message}` }],
    isError: true,
  }
}

/**
 * Derive the sibling `diagnosis` for a graph-write's projected result, so the
 * one field every write tool's guide tells an agent to read after a write is
 * reliably at that top-level key regardless of `return` shape. The two
 * write-echo shapes disagree on where they already have it:
 *
 * - `"full"` is the bare persisted `Workflow`, which carries no `diagnosis` of
 *   its own but does carry `workspaceId` — {@link diagnoseWritten} fetches it.
 * - `"summary"`/`"diagnosis"` already compute their diagnosis inline (see
 *   `projectWriteResult`), because they carry no `workspaceId` for
 *   {@link diagnoseWritten} to re-fetch with. Reuse that embedded value as the
 *   sibling rather than re-deriving it — `result` keeps its own copy too, both
 *   `reg.output`'s `.strict()` schema and existing IPC/renderer callers expect
 *   it there.
 */
async function splitDiagnosis(
  router: IpcRouter,
  spec: McpToolSpec,
  data: unknown,
): Promise<{ result: unknown; diagnosis: unknown }> {
  if (spec.diagnoseAfterWrite !== true) return { result: data, diagnosis: undefined }
  if (typeof data === "object" && data !== null && "diagnosis" in data) {
    return { result: data, diagnosis: (data as { diagnosis: unknown }).diagnosis }
  }
  return { result: data, diagnosis: await diagnoseWritten(router, data) }
}

/**
 * Diagnose the workflow a write just produced, so the agent sees graph errors in
 * the write's own response instead of having to know to ask. Static analysis
 * only — no HTTP, no run.
 *
 * Best-effort by design: the write already succeeded and is durable, so a
 * diagnosis that cannot be produced is omitted rather than turned into a
 * failure the caller would reasonably read as "the write didn't land".
 */
async function diagnoseWritten(router: IpcRouter, written: unknown): Promise<unknown> {
  if (typeof written !== "object" || written === null) return undefined
  const { workspaceId, workflowId } = written as { workspaceId?: unknown; workflowId?: unknown }
  if (typeof workspaceId !== "string" || typeof workflowId !== "string") return undefined
  try {
    const result = await router.dispatch(
      { domain: "workflows", action: "diagnose", payload: { workspaceId, workflowId } },
      { redactSecrets: true },
    )
    return result.ok ? result.data : undefined
  } catch {
    return undefined
  }
}

/**
 * Re-lay-out node positions in place on a `workflows.create`/`update`/`patch`
 * call's raw args, BEFORE `router.dispatch` validates and persists them — one
 * write, not a write-then-relayout-then-write-again round trip (each write
 * pushes to cloud sync; doubling that on every MCP graph edit is real latency
 * on a large workflow, not just an extra local disk write).
 *
 * Best-effort like {@link diagnoseWritten}: on anything unexpected this
 * no-ops and lets the original, unmodified args go to `router.dispatch` —
 * `dispatch` still validates and persists correctly, it just keeps whatever
 * positions the caller sent. A layout bug must never block a write.
 */
async function applyAutoLayout(
  router: IpcRouter,
  spec: McpToolSpec,
  args: Record<string, unknown>,
): Promise<void> {
  if (spec.autoLayout !== true || args["layout"] === false) return
  try {
    if (spec.action === "create" || spec.action === "update") {
      const nodes = args["nodes"]
      if (!Array.isArray(nodes)) return // metadata-only update, or a create with no nodes yet
      const edges = Array.isArray(args["edges"])
        ? args["edges"]
        : spec.action === "update"
          ? (await currentWorkflow(router, args))?.edges
          : []
      if (!Array.isArray(edges)) return
      args["nodes"] = layoutWorkflowNodes(nodes as Workflow["nodes"], edges as Workflow["edges"])
      return
    }
    if (spec.action === "patch") {
      const existing = await currentWorkflow(router, args)
      if (existing === undefined) return
      const merged = mergeGraphPatch(existing, args as WorkflowGraphPatch)
      const laidOut = layoutWorkflowNodes(merged.nodes, merged.edges ?? [])
      // `repositionNodes`, not `upsertNodes`: the whole graph moves, but only
      // the nodes the caller actually named should count as "touched" in the
      // summary projection — see `WorkflowGraphPatch.repositionNodes`.
      args["repositionNodes"] = Object.fromEntries(laidOut.map((n) => [n.nodeId, n.position]))
    }
  } catch {
    // fall through with args unchanged
  }
}

/**
 * Internal-only read of the workflow as it is actually stored — unredacted,
 * since the merged result is fed straight back into a write on the same
 * workflow, never shown to the MCP client. Using the normal `redactSecrets:
 * true` read here would bake the literal string `<SECRET>` into every
 * untouched node's config, which the write validators exist specifically to
 * reject (see `guide.ts` "Never write `<SECRET>` back").
 */
async function currentWorkflow(router: IpcRouter, args: Record<string, unknown>): Promise<Workflow | undefined> {
  const { workspaceId, workflowId } = args
  if (typeof workspaceId !== "string" || typeof workflowId !== "string") return undefined
  const result = await router.dispatch(
    { domain: "workflows", action: "get", payload: { workspaceId, workflowId } },
    { redactSecrets: false },
  )
  return result.ok ? (result.data as Workflow) : undefined
}
