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
  /**
   * A regular expression, as source text, matching the agent's own session id in
   * its output — `AgentDefinition.sessionIdPattern`, for agents that mint their
   * id rather than accepting one. Null for every other agent, and the host then
   * does no scanning at all.
   *
   * Source rather than a compiled `RegExp` because this crosses a process
   * boundary as structured-cloned data, which a `RegExp` does not survive as
   * anything useful. The host compiles it, and a pattern that will not compile
   * is treated as absent.
   */
  readonly sessionIdPattern: string | null
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
   * The session started, or stopped, printing.
   *
   * The only thing anyone can honestly say about what an agent is *doing*: a
   * pid tells you a process exists, not whether it is working or sitting at its
   * prompt waiting for the user. The host is the one place that sees every byte
   * — output goes straight to the renderer over a `MessagePort`, and only for
   * the one session a terminal is open on — so a list showing five agents can
   * learn this nowhere else.
   *
   * Edges, not a sample: sent when the flag flips and never while it holds, so
   * an agent streaming a long answer costs two messages rather than one per
   * chunk.
   */
  | { readonly type: "activity"; readonly sessionId: string; readonly busy: boolean }
  /**
   * The agent's own session id, read out of its output — sent once per session,
   * the first time the pattern matches.
   *
   * Once only because the first match is the trustworthy one. A session's output
   * is arbitrary text: an agent asked about its own history will happily print
   * other session ids, and a later "match" is as likely to be one of those as
   * its own. There is no way to tell them apart after the fact, so the host does
   * not try — it takes the first and stops looking.
   */
  | { readonly type: "sessionRef"; readonly sessionId: string; readonly ref: string }
  /**
   * The title the agent set with an OSC escape, whenever it changes.
   *
   * The one piece of what an agent is *working on* that is legible without
   * understanding its output, because setting the terminal title is a
   * convention every TUI already follows for the benefit of the window it is
   * running in. APIWeave is that window.
   */
  | { readonly type: "title"; readonly sessionId: string; readonly title: string }

/**
 * The most output scanned at once when looking for a session id, in characters.
 *
 * The id can appear anywhere, including split across two chunks, so the scan
 * keeps a short tail of what came before and matches against tail + chunk. Big
 * enough to hold any plausible id plus the line around it, small enough that the
 * regex work per chunk stays flat no matter how much a session prints.
 */
export const PTY_SCAN_WINDOW = 512

/**
 * The longest OSC payload the host will accumulate before giving up on it.
 *
 * An OSC sequence ends at BEL or ST, and a stream that opens one and never
 * closes it — truncated output, a confused TUI, deliberate nonsense — would
 * otherwise grow this buffer without bound. Titles are a line at most.
 */
export const PTY_MAX_OSC_LENGTH = 1_024

/**
 * How long a session must print nothing before it is called idle.
 *
 * Long enough to sit out the gaps inside one burst of work — a model streaming
 * tokens, a test runner between files — and short enough that the badge has
 * settled by the time the user's eye reaches it after the agent stops. Below
 * roughly a second this flickers on ordinary output; well above two it keeps
 * claiming an agent is busy after it has plainly finished.
 */
export const PTY_IDLE_AFTER_MS = 1_500

/**
 * How much output the host keeps per session so a terminal that mounts late, or
 * remounts after a renderer reload, is not blank. Bytes rather than chunks: a
 * chunk is whatever the OS handed us, so a chunk count bounds nothing.
 */
export const PTY_REPLAY_MAX_BYTES = 256 * 1024
