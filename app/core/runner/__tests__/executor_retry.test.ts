import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HTTPNodeDataSchema, RunResultSchema } from "@shared/zod-schemas"
import { WorkflowExecutor, retryDelayMs, type WorkflowGraph } from "../executor"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"

function makeExecutor(http = new SafeHttp()): WorkflowExecutor {
  const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xDEADBEEF")
  return new WorkflowExecutor({ clock, rng, http, functions: new DynamicFunctions(clock, rng) })
}

function pollWorkflow(config: Record<string, unknown>): WorkflowGraph {
  return {
    nodes: [
      { nodeId: "start", type: "start" },
      { nodeId: "poll", type: "http-request", config: { method: "GET", ...config } },
      { nodeId: "end", type: "end" },
    ],
    edges: [
      { edgeId: "e1", source: "start", target: "poll" },
      { edgeId: "e2", source: "poll", target: "end" },
    ],
  }
}

const UNTIL_DONE = [
  { source: "status", path: "", operator: "equals", expectedValue: 200 },
  { source: "prev", path: "response.body.status", operator: "equals", expectedValue: "done" },
]

/** A job endpoint that answers 202 pending until its `doneAfter`th request, then 200 done. */
async function startJobServer(doneAfter: number): Promise<{ server: Server; url: string; requests: () => number }> {
  let requests = 0
  const server = createServer((_request, response) => {
    requests += 1
    const done = requests >= doneAfter
    response.writeHead(done ? 200 : 202, { "Content-Type": "application/json" })
    response.end(JSON.stringify({ status: done ? "done" : "pending" }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return { server, url: `http://127.0.0.1:${port}/job`, requests: () => requests }
}

describe("WorkflowExecutor — http-request retry", () => {
  let server: Server | undefined
  afterEach(async () => {
    vi.useRealTimers()
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    server = undefined
  })

  it("polls until the condition holds and passes on that attempt", async () => {
    const job = await startJobServer(3)
    server = job.server
    const output = await makeExecutor().executeWorkflow(
      pollWorkflow({ url: job.url, retry: { maxAttempts: 5, intervalMs: 10, until: UNTIL_DONE } }),
    )
    expect(output.status).toBe("passed")
    expect(job.requests()).toBe(3)
    const result = output.results.find((r) => r.nodeId === "poll")!
    expect(result.attempts?.map((a) => a.statusCode)).toEqual([202, 202, 200])
    expect(result.response).toMatchObject({ statusCode: 200, body: { status: "done" } })
    expect(RunResultSchema.safeParse(result).success).toBe(true)
  })

  it("fails with a clear message when the condition never holds", async () => {
    const job = await startJobServer(Number.POSITIVE_INFINITY)
    server = job.server
    const output = await makeExecutor().executeWorkflow(
      pollWorkflow({ url: job.url, retry: { maxAttempts: 3, intervalMs: 5, until: UNTIL_DONE } }),
    )
    expect(output.status).toBe("failed")
    expect(job.requests()).toBe(3)
    const result = output.results.find((r) => r.nodeId === "poll")!
    expect(result.error).toBe("Condition not met after 3 attempts")
    expect(result.attempts).toHaveLength(3)
    expect(output.nodeStatuses["end"]).toBeUndefined()
  })

  it("stops promptly when the run is cancelled during the wait", async () => {
    const job = await startJobServer(Number.POSITIVE_INFINITY)
    server = job.server
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 100)
    const started = Date.now()
    const output = await makeExecutor().executeWorkflow(
      pollWorkflow({ url: job.url, retry: { maxAttempts: 5, intervalMs: 60_000, until: UNTIL_DONE } }),
      { cancelSignal: controller.signal },
    )
    expect(Date.now() - started).toBeLessThan(1000)
    expect(output.status).toBe("cancelled")
    expect(output.nodeStatuses["poll"]).toBe("skipped")
    expect(output.failedNodes).toEqual([])
    expect(job.requests()).toBe(1)
  })

  it("without a condition, retries network errors and 5xx responses with exponential backoff", async () => {
    vi.useFakeTimers()
    const sentAt: number[] = []
    const responses = [
      () => Promise.reject(new TypeError("fetch failed")),
      () => Promise.resolve(new Response("busy", { status: 503 })),
      () => Promise.resolve(new Response("busy", { status: 503 })),
      () => Promise.resolve(new Response("{}", { status: 200 })),
    ]
    const fetchImpl = (): Promise<Response> => {
      sentAt.push(Date.now())
      return responses[sentAt.length - 1]!()
    }
    const running = makeExecutor(new SafeHttp({ fetchImpl: fetchImpl as never })).executeWorkflow(
      pollWorkflow({
        url: "http://api.test/flaky",
        retry: { maxAttempts: 5, intervalMs: 100, backoff: "exponential", maxIntervalMs: 300 },
      }),
    )
    await vi.advanceTimersByTimeAsync(2000)
    const output = await running
    expect(output.status).toBe("passed")
    expect(sentAt.slice(1).map((time, index) => time - sentAt[index]!)).toEqual([100, 200, 300])
    expect(output.results.find((r) => r.nodeId === "poll")?.attempts?.map((a) => a.statusCode ?? "error")).toEqual([
      "error",
      503,
      503,
      200,
    ])
  })

  it("without a condition, gives up after the last attempt with the cause, and never retries a 4xx", async () => {
    const statuses = [503, 503]
    const http = new SafeHttp({ fetchImpl: (async () => new Response("", { status: statuses.shift() ?? 404 })) as never })
    const output = await makeExecutor(http).executeWorkflow(
      pollWorkflow({ url: "http://api.test/x", retry: { maxAttempts: 2, intervalMs: 0 } }),
    )
    expect(output.results.find((r) => r.nodeId === "poll")?.error).toBe("Failed after 2 attempts: HTTP 503")

    let calls = 0
    const notFound = new SafeHttp({ fetchImpl: (async () => { calls += 1; return new Response("", { status: 404 }) }) as never })
    await makeExecutor(notFound).executeWorkflow(pollWorkflow({ url: "http://api.test/x", retry: { maxAttempts: 3, intervalMs: 0 } }))
    expect(calls).toBe(1)
  })

  it("does not retry a request that could not be sent", async () => {
    const output = await makeExecutor().executeWorkflow(
      pollWorkflow({ url: "ftp://files.test/job", retry: { maxAttempts: 5, intervalMs: 0, until: UNTIL_DONE } }),
    )
    const result = output.results.find((r) => r.nodeId === "poll")!
    expect(result.attempts).toHaveLength(1)
    expect(result.error).toMatch(/Not a requestable/)
  })

  it("computes the wait per attempt", () => {
    expect([1, 2, 3].map((n) => retryDelayMs({ maxAttempts: 4, intervalMs: 50 }, n))).toEqual([50, 50, 50])
    expect([1, 2, 3, 4].map((n) => retryDelayMs({ maxAttempts: 5, intervalMs: 50, backoff: "exponential", maxIntervalMs: 300 }, n)))
      .toEqual([50, 100, 200, 300])
  })

  it("validates the retry settings", () => {
    const parse = (retry: unknown) => HTTPNodeDataSchema.safeParse({ url: "http://x", retry }).success
    expect(parse({ maxAttempts: 10, intervalMs: 2000, backoff: "exponential", maxIntervalMs: 30_000, until: UNTIL_DONE })).toBe(true)
    expect(parse({ maxAttempts: 3, intervalMs: 0 })).toBe(true)
    expect(parse({ maxAttempts: 0, intervalMs: 100 })).toBe(false)
    expect(parse({ maxAttempts: 101, intervalMs: 100 })).toBe(false)
    expect(parse({ maxAttempts: 3, intervalMs: -1 })).toBe(false)
    expect(parse({ maxAttempts: 3 })).toBe(false)
    expect(parse({ maxAttempts: 3, intervalMs: 10, backoff: "linear" })).toBe(false)
    expect(parse({ maxAttempts: 3, intervalMs: 10, until: [{ source: "prev", path: "x", operator: "matches" }] })).toBe(false)
    expect(parse({ maxAttempts: 3, intervalMs: 10, unknown: true })).toBe(false)
  })
})
