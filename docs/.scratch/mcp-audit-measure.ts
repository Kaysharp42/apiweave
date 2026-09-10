import { Client } from "../../app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js"
import { InMemoryTransport } from "../../app/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js"
import { IpcRouter } from "../../app/core/ipc/router"
import { registerAllHandlers, type HandlerDeps } from "../../app/core/ipc/handlers"
import { createMcpServer } from "../../app/core/mcp/server"
import { MCP_GUIDES, MCP_INSTRUCTIONS } from "../../app/core/mcp/guide"
import { WorkflowSchema } from "../../app/shared/zod-schemas/WorkflowSchema"
import { RunSchema } from "../../app/shared/zod-schemas/RunSchema"
import { projectRunToolResult, projectRunSnapshot } from "../../app/core/mcp/run-projection"

async function main(): Promise<void> {
  const router = new IpcRouter()
  // Catalogue-only probe: handlers are registered but never invoked.
  registerAllHandlers(router, {} as HandlerDeps)
  const server = createMcpServer(router, "audit")
  const client = new Client({ name: "catalogue-audit", version: "1" })
  const [ct, st] = InMemoryTransport.createLinkedPair()
  await server.connect(st)
  await client.connect(ct)
  const result = await client.listTools()
  const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value))
  const rows = result.tools.map((tool) => ({
    name: tool.name,
    totalBytes: bytes(tool),
    inputBytes: bytes(tool.inputSchema),
    outputBytes: bytes(tool.outputSchema ?? {}),
    descriptionBytes: Buffer.byteLength(tool.description ?? ""),
  }))
  console.log(JSON.stringify({
    toolCount: rows.length,
    catalogueBytes: bytes(result),
    inputSchemaBytes: rows.reduce((n, r) => n + r.inputBytes, 0),
    outputSchemaBytes: rows.reduce((n, r) => n + r.outputBytes, 0),
    descriptionBytes: rows.reduce((n, r) => n + r.descriptionBytes, 0),
    largest: rows.sort((a, b) => b.totalBytes - a.totalBytes).slice(0, 12),
    instructionsBytes: Buffer.byteLength(MCP_INSTRUCTIONS),
    guides: MCP_GUIDES.map((g) => ({ slug: g.slug, bytes: Buffer.byteLength(g.text) })),
  }, null, 2))
  const timestamp = "2026-09-09T00:00:00.000Z"
  const workflow = WorkflowSchema.parse({
    workspaceId: "ws-audit", workflowId: "wf-audit", name: "Synthetic 130-node workflow",
    rev: 1, createdAt: timestamp, updatedAt: timestamp,
    nodes: Array.from({ length: 130 }, (_, i) => i === 0
      ? { nodeId: `n${i}`, type: "start" }
      : i === 129 ? { nodeId: `n${i}`, type: "end" }
        : { nodeId: `n${i}`, type: "http-request", config: { method: "GET", url: `https://example.test/items/${i}` } }),
    edges: Array.from({ length: 129 }, (_, i) => ({ edgeId: `e${i}`, source: `n${i}`, target: `n${i + 1}` })),
  })
  const run = RunSchema.parse({
    workspaceId: "ws-audit", workflowId: "wf-audit", runId: "run-audit", status: "completed", trigger: "manual",
    rev: 1, createdAt: timestamp, updatedAt: timestamp,
    nodeStatuses: Object.fromEntries(workflow.nodes.map(n => [n.nodeId, "passed"])),
    results: workflow.nodes.map(n => ({ nodeId: n.nodeId, status: "passed", duration: 20, response: { statusCode: 200 } })),
  })
  const sizes = (value: unknown) => ({ compactBytes: bytes(value), prettyBytes: Buffer.byteLength(JSON.stringify(value, null, 2)) })
  const diagnosis = { workflowId: "wf-audit", summary: { errors: 0, warnings: 0, notices: 0 }, diagnostics: [] }
  const summary = { kind: "summary", workflowId: "wf-audit", rev: 2, nodeCount: 130, edgeCount: 129, touchedNodeIds: ["n64"], touchedEdgeIds: [], diagnosis }
  console.log(JSON.stringify({ syntheticOnly: true,
    workflow: sizes(workflow),
    tenWorkflowList: sizes({ items: Array.from({ length: 10 }, (_, i) => ({ ...workflow, workflowId: `wf-${i}` })), total: 10 }),
    patchSummaryEnvelope: sizes({ result: summary, diagnosis }),
    patchSingleDiagnosisEnvelope: sizes({ result: { ...summary, diagnosis: undefined }, diagnosis }),
    runToolProjection: sizes(projectRunToolResult(run)),
    runResourceProjection: sizes(projectRunSnapshot(run)),
  }, null, 2))
  await client.close()
  await server.close()
}
void main()
