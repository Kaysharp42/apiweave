import type { BrowserInspection } from "@shared/types/BrowserInspection"
import type { Run } from "@shared/types/Run"
import type { RunTerminalStatus } from "@shared/types/RunProgressEvent"
import type { InspectedPage } from "../runner/browser/inspect"
import { AGENT_RUN_DENIED_ERROR } from "../runner/scheduler"
import type { AriaScope } from "@shared/types/AriaScope"
import { scopeAriaSnapshot } from "./aria_scope"
import { previewText, type EvidenceBounds } from "./run_evidence"

type InspectedSnapshot = NonNullable<NonNullable<BrowserInspection["page"]>["ariaSnapshot"]>

interface InspectionRequest {
  readonly beforeNodeId?: string
  readonly maxBytes: number
  readonly scope?: AriaScope
  readonly start?: number
  readonly end?: number
}

const TERMINAL_STATUSES: ReadonlySet<Run["status"]> = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
])

/**
 * The `browser.inspect` result for an inspection run. A run still pending or
 * running at the deadline carries no page and says to continue with its runId.
 * `page` is what a finished run handed back: undefined when it never got to
 * read one (cancelled, or the run could not execute), null when no browser step
 * had opened a page.
 */
export function inspectionResult(
  run: Run,
  page: InspectedPage | null | undefined,
  request: InspectionRequest,
): BrowserInspection {
  if (!isTerminal(run.status)) {
    return {
      runId: run.runId,
      status: run.status,
      terminal: false,
      deniedByUser: false,
      failedNodeIds: [...(run.failedNodes ?? [])],
      page: null,
      note: "The run has not finished yet, possibly because it is waiting for the user's approval. Call browser_inspect with this runId to keep waiting; it starts no new run.",
    }
  }
  const deniedByUser = run.error === AGENT_RUN_DENIED_ERROR
  const snapshot = page?.ariaSnapshot !== undefined ? cut(page.ariaSnapshot, request) : undefined
  const notes = [
    missingPageNote(run.status, page, request, deniedByUser),
    snapshot?.maxBytesCut === true
      ? `The ARIA snapshot's ${snapshot.snapshot.scope} scope was cut at ${request.maxBytes} bytes: pass a larger maxBytes, window it with start/end, or scope to another part with scope.`
      : undefined,
    page?.note,
  ].filter((note) => note !== undefined)
  return {
    runId: run.runId,
    status: run.status,
    terminal: true,
    deniedByUser,
    ...(request.beforeNodeId !== undefined ? { stoppedBeforeNodeId: request.beforeNodeId } : {}),
    failedNodeIds: [...(run.failedNodes ?? [])],
    ...(run.error ? { error: run.error } : {}),
    page: page ? { url: page.url, title: page.title, ...(snapshot !== undefined ? { ariaSnapshot: snapshot.snapshot } : {}) } : null,
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
    ...(page?.screenshot !== undefined ? { screenshot: { mime: "image/jpeg", base64: page.screenshot.toString("base64") } } : {}),
  }
}

function isTerminal(status: Run["status"]): status is RunTerminalStatus {
  return TERMINAL_STATUSES.has(status)
}

/** Why there is no page to show, or undefined when there is one. */
function missingPageNote(
  status: RunTerminalStatus,
  page: InspectedPage | null | undefined,
  request: InspectionRequest,
  deniedByUser: boolean,
): string | undefined {
  // A refusal outranks every other reason for a missing page: the agent must
  // tell the user and stop, not inspect again and re-ask them.
  if (deniedByUser) {
    return "The user did not allow this run to send secrets. Tell them, and do not call browser_inspect again for this workflow until they agree."
  }
  if (page === undefined) return status === "cancelled" ? "The run was cancelled before the page was read." : "The run stopped before the page could be read."
  if (page === null) {
    return `No browser step ran${request.beforeNodeId !== undefined ? ` before ${request.beforeNodeId}` : ""}, so no page was open. Add a navigate step first.`
  }
  return undefined
}

/**
 * The snapshot's scoped text, windowed to the request's bytes — the same
 * `previewText` semantics `runs_getNodeResult` uses, so `start`/`end`/`maxBytes`
 * mean the same offsets in both reads. `totalBytes` is the SCOPED text's size;
 * `scope` says which part was extracted, and `scopeNote` why a requested scope
 * fell back to the whole page. `maxBytesCut` says whether the cap actually
 * removed bytes — a window the caller asked for is not a cut, whatever
 * `previewTruncated` states about the preview being partial.
 */
function cut(snapshot: string, request: InspectionRequest): { snapshot: InspectedSnapshot; maxBytesCut: boolean } {
  const scoped = scopeAriaSnapshot(snapshot, request.scope ?? "auto")
  const preview = previewText(scoped.text, {
    maxBytes: request.maxBytes,
    ...(request.start !== undefined ? { start: request.start } : {}),
    ...(request.end !== undefined ? { end: request.end } : {}),
  } satisfies EvidenceBounds)
  return {
    maxBytesCut: preview.maxBytesCut,
    snapshot: {
      preview: preview.preview,
      previewTruncated: preview.previewTruncated,
      totalBytes: preview.totalBytes,
      scope: scoped.applied,
      ...(scoped.note !== undefined ? { scopeNote: scoped.note } : {}),
    },
  }
}
