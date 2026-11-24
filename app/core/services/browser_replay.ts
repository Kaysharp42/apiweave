import type { Page } from "playwright-core"
import type { RunTerminalStatus } from "@shared/types/RunProgressEvent"
import { BrowserSession, type BrowserLaunchSettings } from "../runner/browser/session"
import type { EnqueueRequest, ReplayStop } from "../runner/scheduler"

/** The run scheduler, as far as a replay needs it. */
export interface ReplayScheduler {
  enqueue(request: EnqueueRequest): string
  whenFinished(runId: string): Promise<RunTerminalStatus>
  cancel(runId: string): boolean
}

export interface ReplayRequest {
  readonly workspaceId: string
  readonly workflowId: string
  readonly environmentId: string | null
  /** Where the run stops: before a node, or once it has run. */
  readonly stop: ReplayStop
}

/** Where a replay left the user. */
export type ReplayOutcome =
  /** Every step up to where it stops passed; the page is open on the user's screen, and `close` closes its browser. */
  | { readonly kind: "page"; readonly page: Page; readonly close: () => Promise<void> }
  /** The run did not pass (or was cancelled): its browser is closed. */
  | { readonly kind: "failed"; readonly runId: string; readonly status: RunTerminalStatus }
  /** The run passed, but no browser step up to where it stops opened a page. */
  | { readonly kind: "no-page" }

/**
 * Run the workflow up to a node as an ordinary run — in run history, with the
 * environment's secrets, on the canvas — but in a browser shown on the user's
 * screen that outlives the run, so the user can carry on from the page it
 * left. Aborting `signal` cancels the run, which closes the browser.
 */
export async function replayToNode(
  scheduler: ReplayScheduler,
  /** Headed in the app: the user carries on in this window. */
  launch: BrowserLaunchSettings,
  request: ReplayRequest,
  signal: AbortSignal,
): Promise<ReplayOutcome> {
  const session = new BrowserSession(launch)
  const runId = scheduler.enqueue({
    workspaceId: request.workspaceId,
    workflowId: request.workflowId,
    selectedEnvironmentId: request.environmentId,
    replay: { stop: request.stop, session },
  })
  const cancel = (): void => void scheduler.cancel(runId)
  signal.addEventListener("abort", cancel, { once: true })
  try {
    const status = await scheduler.whenFinished(runId)
    const page = await session.currentPage()
    // Read before closing the session, which closes the page too.
    const closedByUser = page?.isClosed() ?? false
    if (page !== null && !closedByUser && status === "completed" && !signal.aborted) {
      return { kind: "page", page, close: () => session.close() }
    }
    await session.close()
    if (signal.aborted || closedByUser) return { kind: "failed", runId, status: "cancelled" }
    if (status !== "completed") return { kind: "failed", runId, status }
    return { kind: "no-page" }
  } finally {
    signal.removeEventListener("abort", cancel)
  }
}
