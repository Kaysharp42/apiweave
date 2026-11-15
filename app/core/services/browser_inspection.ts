import type { BrowserInspection } from "@shared/types/BrowserInspection"
import type { Run } from "@shared/types/Run"
import type { RunTerminalStatus } from "@shared/types/RunProgressEvent"
import type { InspectedPage } from "../runner/browser/inspect"
import { truncateUtf8 } from "./read_budgets"

type InspectedSnapshot = NonNullable<NonNullable<BrowserInspection["page"]>["ariaSnapshot"]>

interface InspectionRequest {
  readonly beforeNodeId?: string
  readonly maxBytes: number
  readonly timedOut: boolean
}

/**
 * The `browser.inspect` result for a finished inspection run. `page` is what
 * the run handed back: undefined when it never got to read one (cancelled, or
 * the run could not execute), null when no browser step had opened a page.
 */
export function inspectionResult(
  run: Run,
  status: RunTerminalStatus,
  page: InspectedPage | null | undefined,
  request: InspectionRequest,
): BrowserInspection {
  const snapshot = page?.ariaSnapshot !== undefined ? cut(page.ariaSnapshot, request.maxBytes) : undefined
  const notes = [
    missingPageNote(status, page, request),
    snapshot?.previewTruncated === true
      ? `The ARIA snapshot was cut at ${request.maxBytes} bytes: pass a larger maxBytes, or inspect at a step closer to the part of the page you need.`
      : undefined,
    page?.note,
  ].filter((note) => note !== undefined)
  return {
    runId: run.runId,
    status,
    ...(request.beforeNodeId !== undefined ? { stoppedBeforeNodeId: request.beforeNodeId } : {}),
    failedNodeIds: [...(run.failedNodes ?? [])],
    ...(run.error ? { error: run.error } : {}),
    page: page ? { url: page.url, title: page.title, ...(snapshot !== undefined ? { ariaSnapshot: snapshot } : {}) } : null,
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
    ...(page?.screenshot !== undefined ? { screenshot: { mime: "image/jpeg", base64: page.screenshot.toString("base64") } } : {}),
  }
}

/** Why there is no page to show, or undefined when there is one. */
function missingPageNote(status: RunTerminalStatus, page: InspectedPage | null | undefined, request: InspectionRequest): string | undefined {
  if (request.timedOut) return "The run did not finish in time and was cancelled."
  if (page === undefined) return status === "cancelled" ? "The run was cancelled before the page was read." : "The run stopped before the page could be read."
  if (page === null) {
    return `No browser step ran${request.beforeNodeId !== undefined ? ` before ${request.beforeNodeId}` : ""}, so no page was open. Add a navigate step first.`
  }
  return undefined
}

/** The snapshot's first `maxBytes`, cut on a character boundary, with its full size. */
function cut(snapshot: string, maxBytes: number): InspectedSnapshot {
  const totalBytes = Buffer.byteLength(snapshot, "utf8")
  const preview = truncateUtf8(snapshot, maxBytes)
  return { preview, previewTruncated: Buffer.byteLength(preview, "utf8") < totalBytes, totalBytes }
}
