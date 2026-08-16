import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentOutputEvent } from "@shared/types/AgentOutputEvent";

/**
 * xterm.js cannot load in jsdom — it measures canvas contexts at import time —
 * so the whole terminal stack is replaced with fakes that record just what the
 * component's contract needs: writes (and their drain callbacks), keystroke
 * listeners, and the bridge calls that carry backpressure.
 */

interface FakeWrite {
  readonly data: string;
  readonly drain?: () => void;
}

const { terminalInstances, attachOutputMock, setPausedMock } = vi.hoisted(() => ({
  terminalInstances: [] as {
    readonly writes: FakeWrite[];
    readonly disposed: boolean;
    readonly options: { disableStdin?: boolean; screenReaderMode?: boolean };
    readonly customKeyHandler: ((event: KeyboardEvent) => boolean) | null;
    loadAddon: (addon: unknown) => void;
    onData: (listener: (data: string) => void) => { dispose: () => void };
    attachCustomKeyEventHandler: (handler: (event: KeyboardEvent) => boolean) => { dispose: () => void };
  }[],
  attachOutputMock: vi.fn(),
  setPausedMock: vi.fn(),
}))

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80
    rows = 24
    writes: FakeWrite[] = []
    disposed = false
    options: { disableStdin?: boolean; screenReaderMode?: boolean } = {}
    customKeyHandler: ((event: KeyboardEvent) => boolean) | null = null
    constructor(options: { disableStdin?: boolean }) {
      this.options = { ...options }
      terminalInstances.push(this)
    }
    loadAddon = (_addon: unknown): void => undefined
    open = (): void => undefined
    // The drain callback is xterm's own parse-completion signal; the fake
    // keeps it rather than invoking it, because that is the state the
    // backpressure logic exists for: output arrives far faster than it parses.
    write = (data: string, drain?: () => void): void => {
      if (drain === undefined) {
        this.writes.push({ data })
      } else {
        this.writes.push({ data, drain })
      }
    }
    onData = (listener: (data: string) => void): { dispose: () => void } => {
      void listener
      return { dispose: (): void => undefined }
    }
    attachCustomKeyEventHandler = (
      handler: (event: KeyboardEvent) => boolean,
    ): { dispose: () => void } => {
      this.customKeyHandler = handler
      return {
        dispose: (): void => {
          if (this.customKeyHandler === handler) this.customKeyHandler = null
        },
      }
    }
    focus = (): void => undefined
    dispose = (): void => {
      this.disposed = true
    }
  },
}))

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = (): void => undefined
  },
}))

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss = (): void => undefined
    dispose = (): void => undefined
  },
}))

vi.mock("../../../utils/apiweaveClient", () => ({
  agents: {
    setPaused: setPausedMock,
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    attachOutput: attachOutputMock,
  },
}))

class FakeResizeObserver {
  observe = (): void => undefined
  unobserve = (): void => undefined
  disconnect = (): void => undefined
}

vi.stubGlobal("ResizeObserver", FakeResizeObserver)

import { AgentTerminal } from "../AgentTerminal";

/** One chunk large enough to trip PAUSE_ABOVE_BYTES with room to spare. */
function hugeChunk(): string {
  return "x".repeat(256 * 1024)
}

function outputEvent(sessionId: string, data: string): AgentOutputEvent {
  return { sessionId, kind: "output", data }
}

beforeEach(() => {
  vi.clearAllMocks()
  terminalInstances.length = 0
  attachOutputMock.mockImplementation(() => Promise.resolve(() => undefined))
  setPausedMock.mockResolvedValue(undefined)
})

describe("AgentTerminal", () => {
  it("pauses the PTY when unparsed output passes the threshold", async () => {
    const unsubscribe = vi.fn()
    attachOutputMock.mockImplementation(() => Promise.resolve(unsubscribe))
    render(<AgentTerminal sessionId="session-1" />)
    await act(async () => {})

    const onEvent = attachOutputMock.mock.calls[0]?.[1] as (event: AgentOutputEvent) => void
    onEvent(outputEvent("session-1", hugeChunk()))

    expect(setPausedMock).toHaveBeenCalledWith("session-1", true)
  })

  /**
   * The pause exists to protect the terminal's heap, and a closed terminal has
   * no heap left to protect — but the process behind the PTY is still blocked
   * on its stdout. Unmounting must release the pause, or the session is wedged
   * until the user kills it.
   */
  it("resumes a paused PTY when the terminal unmounts", async () => {
    attachOutputMock.mockImplementation(() => Promise.resolve(() => undefined))
    const { unmount } = render(<AgentTerminal sessionId="session-1" />)
    await act(async () => {})

    const onEvent = attachOutputMock.mock.calls[0]?.[1] as (event: AgentOutputEvent) => void
    onEvent(outputEvent("session-1", hugeChunk()))
    expect(setPausedMock).toHaveBeenLastCalledWith("session-1", true)

    unmount()

    expect(setPausedMock).toHaveBeenCalledTimes(2)
    expect(setPausedMock).toHaveBeenLastCalledWith("session-1", false)
  })

  it("leaves an unpaused PTY alone when the terminal unmounts", async () => {
    render(<AgentTerminal sessionId="session-1" />)
    await act(async () => {})

    expect(setPausedMock).not.toHaveBeenCalled()
  })

  it("ignores output for a different session", async () => {
    render(<AgentTerminal sessionId="session-1" />)
    await act(async () => {})

    const onEvent = attachOutputMock.mock.calls[0]?.[1] as (event: AgentOutputEvent) => void
    onEvent(outputEvent("session-2", hugeChunk()))

    expect(setPausedMock).not.toHaveBeenCalled()
    expect(terminalInstances[0]?.writes).toHaveLength(0)
  })

  /**
   * A reopened exited session plays its replay, but there is no process behind
   * the PTY any more — keystrokes must stop at xterm instead of travelling to
   * a process that is gone. `disableStdin` is how xterm does that.
   */
  it("swallows stdin for a read-only session without rebuilding the terminal", async () => {
    const { rerender } = render(<AgentTerminal sessionId="session-1" />)
    await act(async () => {})

    expect(terminalInstances[0]?.options.disableStdin).toBe(false)

    rerender(<AgentTerminal sessionId="session-1" readOnly />)
    expect(terminalInstances[0]?.options.disableStdin).toBe(true)
    // The same instance, not a rebuilt one: flipping to read-only must not
    // throw away the scrollback the user is still reading.
    expect(terminalInstances).toHaveLength(1)
  })

  it("writes the exit into the terminal and announces it to the owner", async () => {
    const onExit = vi.fn()
    render(<AgentTerminal sessionId="session-1" onExit={onExit} />)
    await act(async () => {})

    const onEvent = attachOutputMock.mock.calls[0]?.[1] as (event: AgentOutputEvent) => void
    onEvent({ sessionId: "session-1", kind: "exit", exitCode: 3 })

    const written = terminalInstances[0]?.writes.map((w) => w.data).join("") ?? ""
    expect(written).toContain("[process exited with code 3]")
    expect(onExit).toHaveBeenCalledWith(3)
  })

  it("reports a session whose output is no longer retained", async () => {
    attachOutputMock.mockImplementation(() => Promise.resolve(null))
    render(<AgentTerminal sessionId="session-1" />)
    await act(async () => {})

    const written = terminalInstances[0]?.writes.map((w) => w.data).join("") ?? ""
    expect(written).toContain("This session's output is no longer available.")
  })

  /**
   * The keyboard trap escape hatch. xterm would send Tab to the agent's stdin;
   * the custom key handler returns false for an unmodified Tab so the browser
   * keeps it and focus moves with the normal Tab order.
   */
  it("lets Tab leave the terminal instead of sending it to the agent", async () => {
    render(<AgentTerminal sessionId="session-1" />)
    await act(async () => {})

    const handler = terminalInstances[0]?.customKeyHandler
    expect(handler).not.toBeNull()

    expect(handler?.({ key: "Tab" } as KeyboardEvent)).toBe(false)
    expect(handler?.({ key: "Tab", shiftKey: true } as KeyboardEvent)).toBe(false)
    expect(handler?.({ key: "Tab", ctrlKey: true } as KeyboardEvent)).toBe(true)
    expect(handler?.({ key: "Enter" } as KeyboardEvent)).toBe(true)
  })

  /**
   * Terminal content is a canvas no assistive technology can read; xterm's
   * screen-reader mode is the live region that makes it reachable.
   */
  it("enables xterm's screen reader mode", async () => {
    render(<AgentTerminal sessionId="session-1" />)
    await act(async () => {})

    expect(terminalInstances[0]?.options.screenReaderMode).toBe(true)
  })
})
