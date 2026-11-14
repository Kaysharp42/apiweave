import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { WorkflowExecutor, type ExecutorOutput, type WorkflowGraph } from "../executor"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"
import type { SnapshotStore } from "../snapshots"
import type { JsonValue } from "@shared/types/JsonValue"

class MapStore implements SnapshotStore {
  public readonly entries = new Map<string, JsonValue>()
  public read(workflowId: string, nodeId: string, ruleIndex: number) {
    const value = this.entries.get(`${workflowId}/${nodeId}/${ruleIndex}`)
    return value === undefined ? undefined : { value, updatedAt: "2026-01-01T00:00:00.000Z" }
  }
  public write(workflowId: string, nodeId: string, ruleIndex: number, value: JsonValue): void {
    this.entries.set(`${workflowId}/${nodeId}/${ruleIndex}`, value)
  }
}

let server: Server | undefined
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  server = undefined
})

async function startJsonServer(body: () => unknown): Promise<string> {
  server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" })
    response.end(JSON.stringify(body()))
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}/order`
}

function graph(url: string, ignorePaths: readonly string[] = []): WorkflowGraph {
  return {
    nodes: [
      { nodeId: "start", type: "start" },
      { nodeId: "fetch", type: "http-request", config: { method: "GET", url } },
      { nodeId: "check", type: "assertion", config: { assertions: [{ source: "prev", path: "response.body", operator: "matchesSnapshot", ...(ignorePaths.length > 0 ? { ignorePaths } : {}) }] } },
      { nodeId: "end", type: "end" },
    ],
    edges: [
      { edgeId: "e1", source: "start", target: "fetch" },
      { edgeId: "e2", source: "fetch", target: "check" },
      { edgeId: "e3", source: "check", target: "end" },
    ],
  }
}

function makeExecutor(store: SnapshotStore | undefined, updateSnapshots = false): WorkflowExecutor {
  const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xDEADBEEF")
  return new WorkflowExecutor({
    clock,
    rng,
    http: new SafeHttp(),
    functions: new DynamicFunctions(clock, rng),
    workflowId: "wf-1",
    ...(store === undefined ? {} : { snapshots: store }),
    ...(updateSnapshots ? { updateSnapshots: true } : {}),
  })
}

const evaluationOf = (output: ExecutorOutput): Record<string, unknown> => {
  const result = output.results.find((candidate) => candidate.nodeId === "check")!
  const evaluations = result.assertions ?? []
  return evaluations[0] as unknown as Record<string, unknown>
}

describe("WorkflowExecutor — matchesSnapshot", () => {
  it("records the response on the first run and passes", async () => {
    const url = await startJsonServer(() => ({ id: "o-1", total: 900 }))
    const store = new MapStore()
    const output = await makeExecutor(store).executeWorkflow(graph(url))
    expect(output.status).toBe("passed")
    expect(evaluationOf(output)).toMatchObject({ outcome: "pass", detail: "Snapshot recorded" })
    expect([...store.entries.values()]).toEqual([{ id: "o-1", total: 900 }])
  })

  it("passes an unchanged response and fails a changed one with the differing location", async () => {
    let total = 900
    const url = await startJsonServer(() => ({ id: "o-1", total }))
    const store = new MapStore()
    expect((await makeExecutor(store).executeWorkflow(graph(url))).status).toBe("passed")

    const unchanged = await makeExecutor(store).executeWorkflow(graph(url))
    expect(unchanged.status).toBe("passed")
    expect(evaluationOf(unchanged)).toMatchObject({ outcome: "pass", detail: "Snapshot matched" })

    total = 950
    const changed = await makeExecutor(store).executeWorkflow(graph(url))
    expect(changed.status).toBe("failed")
    expect(evaluationOf(changed)).toMatchObject({ outcome: "fail", detail: "Snapshot differs in 1 place (first: $['total'])" })
    expect((evaluationOf(changed)["schemaErrors"] as { path: string }[])[0]?.path).toBe("$['total']")
  })

  it("ignores the paths the rule names, so a volatile field does not fail it", async () => {
    let updatedAt = "2026-01-01T00:00:00.000Z"
    const url = await startJsonServer(() => ({ id: "o-1", updatedAt }))
    const store = new MapStore()
    await makeExecutor(store).executeWorkflow(graph(url, ["$..updatedAt"]))
    updatedAt = "2026-11-13T12:00:00.000Z"
    const output = await makeExecutor(store).executeWorkflow(graph(url, ["$..updatedAt"]))
    expect(output.status).toBe("passed")
  })

  it("records again under updateSnapshots instead of failing", async () => {
    let total = 900
    const url = await startJsonServer(() => ({ id: "o-1", total }))
    const store = new MapStore()
    await makeExecutor(store).executeWorkflow(graph(url))
    total = 950
    const output = await makeExecutor(store, true).executeWorkflow(graph(url))
    expect(output.status).toBe("passed")
    expect(evaluationOf(output)).toMatchObject({ detail: "Snapshot updated" })
    expect([...store.entries.values()]).toEqual([{ id: "o-1", total: 950 }])
  })

  it("fails the rule when no snapshot store is available rather than passing silently", async () => {
    const url = await startJsonServer(() => ({ id: "o-1" }))
    const output = await makeExecutor(undefined).executeWorkflow(graph(url))
    expect(output.status).toBe("failed")
    expect(evaluationOf(output)).toMatchObject({ outcome: "fail", detail: "Snapshot storage is unavailable for this run" })
  })

  it("keeps one baseline per rule, so two snapshot rules on a node compare separately", async () => {
    const url = await startJsonServer(() => ({ a: 1, b: 2 }))
    const store = new MapStore()
    const twoRules: WorkflowGraph = {
      ...graph(url),
      nodes: graph(url).nodes.map((node) =>
        node.nodeId === "check"
          ? {
              ...node,
              config: {
                assertions: [
                  { source: "prev", path: "response.body.a", operator: "matchesSnapshot" },
                  { source: "prev", path: "response.body.b", operator: "matchesSnapshot" },
                ],
              },
            }
          : node,
      ),
    }
    const output = await makeExecutor(store).executeWorkflow(twoRules)
    expect(output.status).toBe("passed")
    expect(store.entries.size).toBe(2)
  })
})
