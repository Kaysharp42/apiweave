import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { askRendererToClose, createQuitGate, type CloseRequestTarget } from "../close_handshake"

type Handlers = Parameters<CloseRequestTarget["listen"]>[0]

function makeTarget(alive = true) {
  let handlers: Handlers | null = null
  const unsubscribe = vi.fn()
  const target: CloseRequestTarget = {
    alive: () => alive,
    request: vi.fn(),
    listen: (h) => {
      handlers = h
      return unsubscribe
    },
  }
  const renderer = (): Handlers => {
    if (handlers === null) throw new Error("not listening")
    return handlers
  }
  return { target, renderer, unsubscribe }
}

describe("askRendererToClose", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("does not wait on a dead renderer", async () => {
    const { target } = makeTarget(false)
    await expect(askRendererToClose(target)).resolves.toBe(true)
    expect(target.request).not.toHaveBeenCalled()
  })

  it("resolves with the renderer's reply", async () => {
    const { target, renderer, unsubscribe } = makeTarget()
    const result = askRendererToClose(target, 5000)
    expect(target.request).toHaveBeenCalledTimes(1)
    renderer().ack()
    renderer().reply(false)
    await expect(result).resolves.toBe(false)
    expect(unsubscribe).toHaveBeenCalled()
  })

  it("closes anyway when the renderer never acknowledges", async () => {
    const { target } = makeTarget()
    const result = askRendererToClose(target, 5000)
    vi.advanceTimersByTime(5000)
    await expect(result).resolves.toBe(true)
  })

  it("waits past the timeout once acknowledged — the user may be answering a prompt", async () => {
    const { target, renderer } = makeTarget()
    let settled: boolean | null = null
    void askRendererToClose(target, 5000).then((v) => (settled = v))
    renderer().ack()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(settled).toBeNull()
    renderer().reply(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(true)
  })

  it("closes when the renderer goes away mid-handshake", async () => {
    const { target, renderer } = makeTarget()
    const result = askRendererToClose(target, 5000)
    renderer().ack()
    renderer().gone()
    await expect(result).resolves.toBe(true)
  })
})

describe("createQuitGate", () => {
  it("asks once, refuses meanwhile, then quits and lets the second pass through", async () => {
    let resolveAsk: (proceed: boolean) => void = () => undefined
    const ask = vi.fn(() => new Promise<boolean>((resolve) => (resolveAsk = resolve)))
    const quit = vi.fn()
    const mayQuit = createQuitGate(ask, quit)

    expect(mayQuit()).toBe(false)
    expect(mayQuit()).toBe(false)
    expect(ask).toHaveBeenCalledTimes(1)

    resolveAsk(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(quit).toHaveBeenCalledTimes(1)
    expect(mayQuit()).toBe(true)
  })

  it("stays shut on cancel and asks again next time", async () => {
    const ask = vi.fn(() => Promise.resolve(false))
    const quit = vi.fn()
    const mayQuit = createQuitGate(ask, quit)

    expect(mayQuit()).toBe(false)
    await Promise.resolve()
    await Promise.resolve()
    expect(quit).not.toHaveBeenCalled()

    expect(mayQuit()).toBe(false)
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it("runs the caller's own quit instead once the renderer agrees", async () => {
    const quit = vi.fn()
    const install = vi.fn()
    const mayQuit = createQuitGate(() => Promise.resolve(true), quit)

    expect(mayQuit(install)).toBe(false)
    await Promise.resolve()
    await Promise.resolve()
    expect(install).toHaveBeenCalledTimes(1)
    expect(quit).not.toHaveBeenCalled()
    expect(mayQuit()).toBe(true)
  })
})
