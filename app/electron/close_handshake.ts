/**
 * The quit handshake with the renderer, kept free of Electron so it can be
 * tested: before the window closes or the app quits, the renderer flushes its
 * pending auto-save and asks the user about anything still unsaved.
 */

/** The one window's side of the handshake, as main sees it. */
export interface CloseRequestTarget {
  /** False once the page is destroyed or crashed: nobody is left to ask. */
  readonly alive: () => boolean
  readonly request: () => void
  /** Subscribes to the renderer's answers; returns the unsubscribe. */
  readonly listen: (handlers: {
    readonly ack: () => void
    readonly reply: (proceed: boolean) => void
    readonly gone: () => void
  }) => () => void
}

/**
 * How long a renderer has to acknowledge the request. Only the ack is timed:
 * once a live page has it, it may be showing the user a Save / Discard /
 * Cancel question, and no timer may close the window under that.
 */
export const CLOSE_ACK_TIMEOUT_MS = 5000

/** Resolves whether the window may close. A dead or hung renderer means yes. */
export function askRendererToClose(
  target: CloseRequestTarget,
  ackTimeoutMs: number = CLOSE_ACK_TIMEOUT_MS,
): Promise<boolean> {
  if (!target.alive()) return Promise.resolve(true)
  return new Promise((resolve) => {
    let done = false
    const finish = (proceed: boolean): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      unsubscribe()
      resolve(proceed)
    }
    const timer = setTimeout(() => finish(true), ackTimeoutMs)
    const unsubscribe = target.listen({
      ack: () => clearTimeout(timer),
      reply: finish,
      gone: () => finish(true),
    })
    target.request()
  })
}

/**
 * Gates quitting on one handshake at a time. `mayQuit` answers whether the
 * close or quit in progress can go ahead now; when it cannot, the caller
 * cancels that one and the gate quits again itself once the renderer agrees.
 * After that the gate stays open, so the second pass through `before-quit`
 * and the window's `close` goes straight through instead of asking again.
 * A caller that quits some other way — installing an update — passes that as
 * `then`, so the user is asked before anything irreversible starts.
 */
export function createQuitGate(
  ask: () => Promise<boolean>,
  quit: () => void,
): (then?: () => void) => boolean {
  let open = false
  let asking = false
  return (then = quit) => {
    if (open) return true
    if (!asking) {
      asking = true
      void ask().then((proceed) => {
        asking = false
        if (!proceed) return
        open = true
        then()
      })
    }
    return false
  }
}
