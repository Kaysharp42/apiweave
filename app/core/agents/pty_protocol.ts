/**
 * The message contract between the main process and the PTY host
 * (`electron/pty_host.ts`), which runs as an Electron `utilityProcess`.
 *
 * Declared once, in a file neither side owns, for the same reason
 * `AgentsBridge` is: both ends are real code, and a protocol described twice is
 * a protocol that drifts. Nothing here is renderer-facing — the renderer's half
 * of the conversation is {@link AgentOutputEvent}, delivered over a
 * `MessagePort` that skips the main process entirely.
 */

/** Everything needed to start one PTY. Composed in main; the host adds nothing. */
export interface PtySpawnRequest {
  readonly sessionId: string
  /** Already resolved to an absolute path, and already `cmd.exe /c`-wrapped if it is a shim. */
  readonly file: string
  readonly args: readonly string[]
  readonly cwd: string
  /** Merged over the host's own environment, not replacing it — the agent needs PATH. */
  readonly env: Readonly<Record<string, string>>
  readonly cols: number
  readonly rows: number
}

export type PtyHostRequest =
  | ({ readonly type: "spawn" } & PtySpawnRequest)
  | { readonly type: "write"; readonly sessionId: string; readonly data: string }
  | { readonly type: "resize"; readonly sessionId: string; readonly cols: number; readonly rows: number }
  /**
   * Backpressure, out of band. node-pty also offers in-band flow control
   * (`handleFlowControl`), which is deliberately left off: its default pause
   * string is XOFF, so enabling it would silently eat the user's Ctrl+S instead
   * of forwarding it to the agent. `IPty.pause()`/`resume()` does the same job
   * without touching the input stream.
   */
  | { readonly type: "setPaused"; readonly sessionId: string; readonly paused: boolean }
  /** Carries exactly one transferred `MessagePort` — see {@link AgentOutputEvent}. */
  | { readonly type: "attach"; readonly sessionId: string }
  | { readonly type: "kill"; readonly sessionId: string }
  | { readonly type: "shutdown" }

export type PtyHostReply =
  | { readonly type: "spawned"; readonly sessionId: string; readonly pid: number }
  | {
      readonly type: "exited"
      readonly sessionId: string
      readonly exitCode: number
      readonly signal: number | null
    }
  /** The spawn never happened at all — a missing binary, a cwd that vanished. */
  | { readonly type: "failed"; readonly sessionId: string; readonly message: string }
  /** The host dropped an exited session's replay, so no re-attach can be served. */
  | { readonly type: "pruned"; readonly sessionId: string }

/**
 * How much output the host keeps per session so a terminal that mounts late, or
 * remounts after a renderer reload, is not blank. Bytes rather than chunks: a
 * chunk is whatever the OS handed us, so a chunk count bounds nothing.
 */
export const PTY_REPLAY_MAX_BYTES = 256 * 1024
