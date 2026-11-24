import { z } from "zod"

/**
 * Which part of an ARIA snapshot a bounded read returns. Scoping is applied at
 * READ time on the stored snapshot text, so it works identically for stored
 * run evidence and live inspection, and never changes what was captured.
 *
 * - `"auto"` — the last open `dialog`/`alertdialog` if any, else the first
 *   `main` landmark, else the whole page. The default: the part a locator is
 *   usually being picked from, instead of the navigation chrome that opens
 *   every snapshot.
 * - `"dialog"` — the LAST `dialog`/`alertdialog` in document order (the most
 *   recently opened one is usually the last).
 * - `"main"` — the first `main` landmark.
 * - `"page"` — everything, no scoping.
 *
 * A requested scope that the page does not have falls back to the whole page,
 * stated in the response's scope note.
 */
export const AriaScopeSchema = z
  .enum(["auto", "main", "dialog", "page"])
  .describe("Which part of an ARIA snapshot to return (default \"auto\": the open dialog if any, else the main landmark, else the whole page). Byte windowing (maxBytes/start/end) applies to the scoped text, whose applied scope and total bytes the response reports.")

/** The scope a read actually applied: `"auto"` is resolved to one of these. */
export const AppliedAriaScopeSchema = z
  .enum(["dialog", "main", "page"])
  .describe("Which part of the page's ARIA snapshot this preview windows: the open dialog, the main landmark, or the whole page.")
