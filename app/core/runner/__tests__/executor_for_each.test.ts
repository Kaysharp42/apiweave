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

  it("resolves a list from {{prev.…}} as the array it names", async () => {
    const { createServer } = await import("node:http")
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ ids: [1, 2, 3] }))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as { port: number }).port
    try {
      const output = await run({
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "fetch", type: "http-request", config: { method: "GET", url: `http://127.0.0.1:${port}/ids` } },
          {
            nodeId: "call1",
            type: "workflow",
            config: {
              targetWorkflowId: "child",
              outputMapping: { echoed: "item" },
              forEach: { items: "{{prev.response.body.ids}}", itemVariable: "item" },
            },
          },
          { nodeId: "end", type: "end" },
        ],
        edges: [
          { edgeId: "e1", source: "start", target: "fetch" },
          { edgeId: "e2", source: "fetch", target: "call1" },
          { edgeId: "e3", source: "call1", target: "end" },
        ],
      })
      expect(output.status).toBe("passed")
      expect(output.extractedVariables["echoed"]).toEqual([1, 2, 3])
    } finally {
      server.close()
    }
  })

  it("refuses a for-each over a seeded prev result that was masked in the source run", async () => {
    const executor = new WorkflowExecutor({ ...makeDeps(), resolveWorkflow: () => echoChild })
    const output = await executor.executeWorkflow(
      {
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "fetch", type: "http-request", config: { method: "GET", url: "https://api.example.test/ids" } },
          {
            nodeId: "call1",
            type: "workflow",
            config: {
              targetWorkflowId: "child",
              outputMapping: { echoed: "item" },
              forEach: { items: "{{prev.response.body.items}}", itemVariable: "item" },
            },
          },
          { nodeId: "end", type: "end" },
        ],
        edges: [
          { edgeId: "e1", source: "start", target: "fetch" },
          { edgeId: "e2", source: "fetch", target: "call1" },
          { edgeId: "e3", source: "call1", target: "end" },
        ],
      },
      {
        startNodeIds: ["call1"],
        resume: {
          scope: new Set(["call1", "end"]),
          results: [{
            nodeId: "fetch",
            status: "passed",
            duration: 5,
            response: { statusCode: 200, body: { items: ["<SECRET>", "kept"] } },
          }],
          maskedVariables: [],
        },
      },
    )

    expect(output.status).toBe("failed")
    const error = output.results.find((result) => result.nodeId === "call1")?.error
    expect(error).toContain("{{prev.response.body.items}} was masked in the source run")
    expect(error).toContain("Not rerun:")
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
      const result = output.results.find((r) => r.nodeId === "call1")
      // The failure text is the node's `error`, so the run record and every
      // evidence read carry which iteration broke.
      expect(result?.error).toBe("Sub-workflow Http failed in iteration 2")
      const forEach = result?.subWorkflow?.forEach
      expect(forEach).toMatchObject({ itemCount: 4, ranCount: 2, failedCount: 1 })
    })

    it("with stopOnFailure false runs everything and reports the failed count", async () => {
      const output = await run(
        caller({ items: '["ok","bad","ok2"]', itemVariable: "item", stopOnFailure: false }, { continueOnFail: true }),
        httpChild(),
      )
      const result = output.results.find((r) => r.nodeId === "call1")
      expect(result?.status).toBe("failed")
      expect(result?.error).toBe("Sub-workflow Http: 1 of 3 iteration(s) failed")
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

  it("passes the input mapping into every iteration, beside the item", async () => {
    const output = await run(
      caller(
        { items: "[1,2,3]", itemVariable: "item" },
        { inputMapping: { tenant: "{{variables.tenant}}", limits: "{{variables.limits}}" }, outputMapping: { tenants: "tenant", limitSets: "limits", echoed: "item" } },
        { tenant: "tenant-a", limits: { max: 5 } },
      ),
    )
    expect(output.status).toBe("passed")
    expect(output.extractedVariables["tenants"]).toEqual(["tenant-a", "tenant-a", "tenant-a"])
    expect(output.extractedVariables["limitSets"]).toEqual([{ max: 5 }, { max: 5 }, { max: 5 }])
    expect(output.extractedVariables["echoed"]).toEqual([1, 2, 3])
  })

  it("fails before any iteration when the input mapping does not resolve in the caller", async () => {
    const begun: string[] = []
    const subRun = {
      begin: (workflowId: string) => {
        begun.push(workflowId)
        return { runId: `run-${begun.length}`, deps: { ...makeDeps() } }
      },
      finish: () => undefined,
    }
    const output = await run(
      caller({ items: "[1,2]", itemVariable: "item" }, { inputMapping: { tenant: "{{variables.tenant}}" } }),
      echoChild,
      { subRun },
    )
    expect(output.status).toBe("failed")
    expect(output.results.find((r) => r.nodeId === "call1")?.error).toBe("inputMapping.tenant: {{variables.tenant}} is not set in the caller")
    expect(begun).toEqual([])
    expect(output.extractedVariables).not.toHaveProperty("echoed")
  })

  describe("with an object item read field by field in the child", () => {
    let server: Server
    let port: number
    const paths: string[] = []

    beforeEach(async () => {
      paths.length = 0
      server = createServer((req, res) => {
        paths.push(req.url ?? "")
        res.end("{}")
      })
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      port = (server.address() as { port: number }).port
    })
    afterEach(() => {
      server.closeAllConnections()
      server.close()
    })

    it("resolves {{variables.case.title}} against each item", async () => {
      const child: ResolvedSubWorkflow = {
        name: "Case",
        nodes: [
          { nodeId: "start", type: "start" },
          { nodeId: "h", type: "http-request", config: { url: `http://127.0.0.1:${port}/{{variables.case.title}}/{{variables.case.meta.rank}}` } },
        ],
        edges: [{ edgeId: "e1", source: "start", target: "h" }],
      }
      const output = await run(
        caller({ items: "{{variables.cases}}", itemVariable: "case" }, {}, { cases: [{ title: "first", meta: { rank: 1 } }, { title: "second", meta: { rank: 2 } }] }),
        child,
      )
      expect(output.status).toBe("passed")
      expect(paths).toEqual(["/first/1", "/second/2"])
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
