import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createServer, type Server } from "node:http"
import { WorkflowExecutor, type ExecutorOutput, type ResolvedSubWorkflow, type WorkflowGraph } from "../executor"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"

function makeDeps() {
  const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xDEADBEEF")
  return { clock, rng, http: new SafeHttp(), functions: new DynamicFunctions(clock, rng) }
}

const echoChild: ResolvedSubWorkflow = {
  name: "Echo",
  nodes: [
    { nodeId: "start", type: "start" },
    { nodeId: "end", type: "end" },
  ],
  edges: [{ edgeId: "e1", source: "start", target: "end" }],
}

function caller(forEach: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}, variables: Record<string, unknown> = {}): WorkflowGraph {
  return {
    nodes: [
      { nodeId: "start", type: "start" },
      {
        nodeId: "call1",
        type: "workflow",
        config: { targetWorkflowId: "child", outputMapping: { echoed: "item", indexes: "i" }, ...(forEach ? { forEach } : {}), ...extra },
      },
      { nodeId: "end", type: "end" },
    ],
    edges: [
      { edgeId: "e1", source: "start", target: "call1" },
      { edgeId: "e2", source: "call1", target: "end" },
    ],
    variables,
  }
}

function run(graph: WorkflowGraph, child: ResolvedSubWorkflow = echoChild, extraDeps: Record<string, unknown> = {}, signal?: AbortSignal): Promise<ExecutorOutput> {
  const executor = new WorkflowExecutor({ ...makeDeps(), resolveWorkflow: () => child, ...extraDeps })
  return executor.executeWorkflow(graph, signal ? { cancelSignal: signal } : {})
}

describe("Call Workflow forEach", () => {
  it("runs once per item and collects outputs in item order", async () => {
    const output = await run(
      caller({ items: "{{variables.ids}}", itemVariable: "item", indexVariable: "i" }, {}, { ids: ["a", "b", "c"] }),
    )
    expect(output.status).toBe("passed")
    expect(output.extractedVariables["echoed"]).toEqual(["a", "b", "c"])
    expect(output.extractedVariables["indexes"]).toEqual([0, 1, 2])
    const sub = output.results.find((r) => r.nodeId === "call1")?.subWorkflow
    expect(sub?.forEach).toMatchObject({ itemCount: 3, ranCount: 3, failedCount: 0 })
    expect(sub?.forEach?.iterations.map((i) => i.index)).toEqual([0, 1, 2])
  })

  it("accepts a JSON array literal and a JSONPath that selects an array", async () => {
    const literal = await run(caller({ items: "[1,2]", itemVariable: "item" }))
    expect(literal.extractedVariables["echoed"]).toEqual([1, 2])
    const path = await run(caller({ items: "$.variables.ids", itemVariable: "item" }, {}, { ids: ["x", "y"] }))
    expect(path.extractedVariables["echoed"]).toEqual(["x", "y"])
    const filtered = await run(
      caller({ items: "$.variables.users[?@.on==true].name", itemVariable: "item" }, {}, { users: [{ name: "p", on: true }, { name: "q", on: false }, { name: "r", on: true }] }),
    )
    expect(filtered.extractedVariables["echoed"]).toEqual(["p", "r"])
  })

  it("fails the node when items is not an array or itemVariable is missing", async () => {
    const notArray = await run(caller({ items: "{{variables.n}}", itemVariable: "item" }, {}, { n: 3 }))
    expect(notArray.status).toBe("failed")
    const noVar = await run(caller({ items: "[1]" }))
    expect(noVar.status).toBe("failed")
  })

  it("passes an empty list with empty output arrays", async () => {
    const output = await run(caller({ items: "[]", itemVariable: "item" }))
    expect(output.status).toBe("passed")
    expect(output.extractedVariables["echoed"]).toEqual([])
  })

  it("caps the iteration count at 1000", async () => {
    const items = JSON.stringify(Array.from({ length: 1005 }, (_, i) => i))
    const output = await run(caller({ items, itemVariable: "item", concurrency: 16 }))
    const forEach = output.results.find((r) => r.nodeId === "call1")?.subWorkflow?.forEach
    expect(forEach?.itemCount).toBe(1000)
    expect((output.extractedVariables["echoed"] as unknown[]).length).toBe(1000)
  })

  describe("with failing items", () => {
    let server: Server
    let port: number
    let inFlight = 0
    let maxInFlight = 0

    beforeEach(async () => {
      inFlight = 0
      maxInFlight = 0
      server = createServer((req, res) => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        setTimeout(() => {
          inFlight -= 1
          res.statusCode = req.url === "/bad" ? 500 : 200
          res.end("{}")
        }, 30)
      })
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      port = (server.address() as { port: number }).port
    })
    afterEach(() => {
      server.closeAllConnections()
      server.close()
    })

    const httpChild = (): ResolvedSubWorkflow => ({
      name: "Http",
      nodes: [
        { nodeId: "start", type: "start" },
        { nodeId: "h", type: "http-request", config: { url: `http://127.0.0.1:${port}/{{variables.item}}` } },
      ],
      edges: [{ edgeId: "e1", source: "start", target: "h" }],
    })

    it("stops starting iterations after the first failure by default", async () => {
      const output = await run(caller({ items: '["ok","bad","ok2","ok3"]', itemVariable: "item" }), httpChild())
      expect(output.status).toBe("failed")
      const forEach = output.results.find((r) => r.nodeId === "call1")?.subWorkflow?.forEach
      expect(forEach).toMatchObject({ itemCount: 4, ranCount: 2, failedCount: 1 })
    })

    it("with stopOnFailure false runs everything and reports the failed count", async () => {
      const output = await run(
        caller({ items: '["ok","bad","ok2"]', itemVariable: "item", stopOnFailure: false }, { continueOnFail: true }),
        httpChild(),
      )
      const result = output.results.find((r) => r.nodeId === "call1")
      expect(result?.status).toBe("failed")
      expect(result?.subWorkflow?.forEach).toMatchObject({ ranCount: 3, failedCount: 1 })
      expect(result?.subWorkflow?.forEach?.iterations.map((i) => i.status)).toEqual(["passed", "failed", "passed"])
    })

    it("runs up to `concurrency` iterations at once and keeps item order", async () => {
      const output = await run(caller({ items: '["a","b","c","d","e","f"]', itemVariable: "item", concurrency: 3 }), httpChild())
      expect(output.status).toBe("passed")
      expect(maxInFlight).toBe(3)
      expect(output.extractedVariables["echoed"]).toEqual(["a", "b", "c", "d", "e", "f"])
    })

    it("runs sequentially by default", async () => {
      await run(caller({ items: '["a","b","c"]', itemVariable: "item" }), httpChild())
      expect(maxInFlight).toBe(1)
    })

    it("stops on cancel and records the node as cancelled", async () => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 45)
      const output = await run(
        caller({ items: '["a","b","c","d","e","f"]', itemVariable: "item" }),
        httpChild(),
        {},
        controller.signal,
      )
      expect(output.status).toBe("cancelled")
      const result = output.results.find((r) => r.nodeId === "call1")
      expect(result?.status).toBe("skipped")
      expect(output.nodeStatuses["end"]).toBeUndefined()
    })
  })

  it("records one child run per iteration through subRun", async () => {
    const begun: string[] = []
    const finished: string[] = []
    const subRun = {
      begin: (workflowId: string) => {
        const runId = `run-${begun.length}`
        begun.push(workflowId)
        return { runId, deps: { ...makeDeps() } }
      },
      finish: (runId: string) => void finished.push(runId),
    }
    const output = await run(caller({ items: "[1,2,3]", itemVariable: "item" }), echoChild, { subRun })
    expect(begun).toEqual(["child", "child", "child"])
    expect(finished).toEqual(["run-0", "run-1", "run-2"])
    const iterations = output.results.find((r) => r.nodeId === "call1")?.subWorkflow?.forEach?.iterations
    expect(iterations?.map((i) => i.runId)).toEqual(["run-0", "run-1", "run-2"])
  })
})
