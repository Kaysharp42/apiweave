import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { ZodError } from "zod"
import type { WebContents } from "electron"
import { createApiweaveClient } from "@shared/contract/client"
import { IpcRouter, NotFoundError } from "../index"
import { emitRunProgress, runProgressChannel } from "../register"
import type { RunProgressEvent } from "@shared/types/RunProgressEvent"
import { SECRET_PLACEHOLDER } from "../../services/secret_utils"

const echoInput = z.object({ x: z.number() })
const echoOutput = z.object({ x: z.number(), timestamp: z.string() })

function echoRouter(): IpcRouter {
  const router = new IpcRouter()
  router.register("test", "echo", {
    input: echoInput,
    output: echoOutput,
    handle: (input) => ({ x: input.x, timestamp: "2026-07-06T00:00:00.000Z" }),
  })
  return router
}

describe("IpcRouter.dispatch", () => {
  it("returns { ok: true, data } for a valid call", async () => {
    const result = await echoRouter().dispatch({ domain: "test", action: "echo", payload: { x: 42 } })
    expect(result.ok).toBe(true)
    expect(result.ok === true && result.data).toEqual({ x: 42, timestamp: "2026-07-06T00:00:00.000Z" })
  })

  it("returns a validation envelope when the payload fails the input schema", async () => {
    const result = await echoRouter().dispatch({ domain: "test", action: "echo", payload: { x: "nope" } })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error.code).toBe("validation")
  })

  it("maps a thrown NotFoundError to a not_found envelope (never throws out)", async () => {
    const router = new IpcRouter()
    router.register("workspaces", "get", {
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string() }),
      handle: () => {
        throw new NotFoundError("workspace B does not exist")
      },
    })
    const result = await router.dispatch({ domain: "workspaces", action: "get", payload: { id: "B" } })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error.code).toBe("not_found")
    expect(result.ok === false && result.error.code).not.toBe("denied")
  })

  it("returns not_found for an unregistered action", async () => {
    const result = await new IpcRouter().dispatch({ domain: "ghost", action: "nope", payload: {} })
    expect(result.ok === false && result.error.code).toBe("not_found")
  })

  it("rejects registering the same domain.action twice", () => {
    const router = echoRouter()
    expect(() =>
      router.register("test", "echo", { input: echoInput, output: echoOutput, handle: () => ({ x: 0, timestamp: "" }) }),
    ).toThrow(/duplicate/)
  })

  it("re-throws an unexpected handler error (HTTP-500 equivalent, not an envelope)", async () => {
    const router = new IpcRouter()
    router.register("boom", "now", {
      input: z.object({}),
      output: z.object({}),
      handle: () => {
        throw new Error("kaboom")
      },
    })
    await expect(router.dispatch({ domain: "boom", action: "now", payload: {} })).rejects.toThrow("kaboom")
  })

  it("refuses to store a redacted secret placeholder when redactSecrets is set", async () => {
    const router = echoRouter()
    const result = await router.dispatch(
      { domain: "test", action: "echo", payload: { x: SECRET_PLACEHOLDER } },
      { redactSecrets: true },
    )
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error.code).toBe("validation")
    expect(result.ok === false && result.error.message).toContain(SECRET_PLACEHOLDER)
  })

  it("throws (HTTP-500 equivalent) when a handler's output fails its own schema", async () => {
    const router = new IpcRouter()
    router.register("bad", "output", {
      input: z.object({}),
      // The handler lies about its return type — output.parse must reject it.
      output: z.object({ required: z.string() }),
      handle: () => ({}) as never,
    })
    await expect(router.dispatch({ domain: "bad", action: "output", payload: {} })).rejects.toThrow(ZodError)
  })

  it("maps a ZodError thrown by a handler to a validation envelope (never throws out)", async () => {
    const router = new IpcRouter()
    router.register("parse", "fails", {
      input: z.object({}),
      output: z.object({}),
      handle: () => {
        z.object({ id: z.string() }).parse({})
        return {}
      },
    })
    const result = await router.dispatch({ domain: "parse", action: "fails", payload: {} })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error.code).toBe("validation")
  })
})

describe("IpcRouter error reporting", () => {
  it("reports a rejected dispatch to the observer with domain, action, code and message", async () => {
    const reportError = vi.fn()
    const router = new IpcRouter({ reportError })
    router.register("test", "echo", {
      input: echoInput,
      output: echoOutput,
      handle: (input) => ({ x: input.x, timestamp: "2026-07-06T00:00:00.000Z" }),
    })
    const result = await router.dispatch({ domain: "test", action: "echo", payload: { x: "nope" } })
    expect(result.ok).toBe(false)
    expect(reportError).toHaveBeenCalledOnce()
    const report = reportError.mock.calls[0]?.[0]
    expect(report).toMatchObject({
      domain: "test",
      action: "echo",
      code: "validation",
      message: "request validation failed",
    })
  })

  it("reports a thrown AppError under its own code", async () => {
    const reportError = vi.fn()
    const router = new IpcRouter({ reportError })
    router.register("workspaces", "get", {
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string() }),
      handle: () => {
        throw new NotFoundError("workspace B does not exist")
      },
    })
    const result = await router.dispatch({ domain: "workspaces", action: "get", payload: { id: "B" } })
    expect(result.ok).toBe(false)
    expect(reportError.mock.calls[0]?.[0]).toMatchObject({
      domain: "workspaces",
      action: "get",
      code: "not_found",
      message: "workspace B does not exist",
    })
  })

  it("reports an internal handler failure before re-throwing it", async () => {
    const reportError = vi.fn()
    const router = new IpcRouter({ reportError })
    router.register("boom", "now", {
      input: z.object({}),
      output: z.object({}),
      handle: () => {
        throw new Error("kaboom")
      },
    })
    await expect(router.dispatch({ domain: "boom", action: "now", payload: {} })).rejects.toThrow("kaboom")
    expect(reportError).toHaveBeenCalledOnce()
    expect(reportError.mock.calls[0]?.[0]).toMatchObject({ code: "internal", message: "kaboom" })
  })

  it("still returns the envelope when the observer itself throws", async () => {
    const router = new IpcRouter({
      reportError: () => {
        throw new Error("logger broke")
      },
    })
    router.register("test", "echo", {
      input: echoInput,
      output: echoOutput,
      handle: (input) => ({ x: input.x, timestamp: "2026-07-06T00:00:00.000Z" }),
    })
    const result = await router.dispatch({ domain: "test", action: "echo", payload: { x: "nope" } })
    expect(result.ok).toBe(false)
  })

  it("reports response validation failures under the internal code before re-throwing", async () => {
    const reportError = vi.fn()
    const router = new IpcRouter({ reportError })
    router.register("bad", "output", {
      input: z.object({}),
      output: z.object({ required: z.string() }),
      handle: () => ({}) as never,
    })
    await expect(router.dispatch({ domain: "bad", action: "output", payload: {} })).rejects.toThrow(ZodError)
    expect(reportError).toHaveBeenCalledOnce()
    expect(reportError.mock.calls[0]?.[0]).toMatchObject({
      domain: "bad",
      action: "output",
      code: "internal",
      message: "response validation failed",
    })
  })

  it("reports a ZodError thrown by a handler as a validation failure", async () => {
    const reportError = vi.fn()
    const router = new IpcRouter({ reportError })
    router.register("parse", "fails", {
      input: z.object({}),
      output: z.object({}),
      handle: () => {
        z.object({ id: z.string() }).parse({})
        return {}
      },
    })
    const result = await router.dispatch({ domain: "parse", action: "fails", payload: {} })
    expect(result.ok).toBe(false)
    expect(reportError.mock.calls[0]?.[0]).toMatchObject({
      domain: "parse",
      action: "fails",
      code: "validation",
      message: "response validation failed",
    })
  })
})

describe("createApiweaveClient", () => {
  it("turns client.domain.action(payload) into invoke(domain, action, payload)", async () => {
    const invoke = vi.fn(async () => ({ ok: true as const, data: { echoed: true } }))
    const client = createApiweaveClient(invoke)
    const result = await client.test.echo({ x: 1 })
    expect(invoke).toHaveBeenCalledWith("test", "echo", { x: 1 })
    expect(result).toEqual({ ok: true, data: { echoed: true } })
  })
})

describe("run progress streaming", () => {
  it("emits on the per-run topic channel", () => {
    const send = vi.fn()
    const webContents = { send } as unknown as WebContents
    const event: RunProgressEvent = {
      kind: "node.completed",
      runId: "run-1",
      nodeId: "node-a",
      status: "passed",
      variables: { token: "abc" },
    }
    emitRunProgress(webContents, event)
    expect(send).toHaveBeenCalledWith(runProgressChannel("run-1"), event)
    expect(runProgressChannel("run-1")).toBe("apiweave:run-progress:run-1")
  })
})
