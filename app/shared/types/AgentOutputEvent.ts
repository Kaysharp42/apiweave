/**
 * What arrives on an agent session's `MessagePort`, straight from the PTY host
 * to the renderer.
 *
 * This is the one payload in the app that does not travel over IPC. Terminal
 * output from a build tool or a test run arrives in thousands of small chunks,
 * and routing all of it through the main process would make the UI thread's
 * throughput a function of main's event-loop latency. The port is created per
 * attach and is therefore per session; `sessionId` is carried anyway so a port
 * still in flight when the view switches sessions cannot paint into the wrong
 * terminal.
 */
/**
 * The key a transferred output port is announced under when preload re-posts it
 * into the page with `window.postMessage`.
 *
 * Shared because both ends are real code: preload posts it and the renderer's
 * client matches on it. Deliberately an unlikely name — a page receives
 * `message` events from anything on it, and this must not collide with a
 * library's own.
 */
export const AGENT_OUTPUT_PORT_MESSAGE_KEY = "__apiweaveAgentOutputPort"

export type AgentOutputEvent =
  | {
      readonly kind: "output"
      readonly sessionId: string
      /** Raw PTY bytes as a string, escape sequences intact — xterm.js is the parser. */
      readonly data: string
    }
  | {
      readonly kind: "exit"
      readonly sessionId: string
      readonly exitCode: number
    }
  /**
   * The host has dropped this finished session's scrollback to make room for a
   * newer one, and is about to close the port.
   *
   * Sent because the alternative is worse: closing the port on its own leaves a
   * terminal that simply stops, indistinguishable from an agent that went quiet.
   * The renderer says so in the transcript instead. Nothing follows this event
   * on the port.
   */
  | {
      readonly kind: "replayReleased"
      readonly sessionId: string
    }
