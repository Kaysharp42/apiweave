/**
 * IPC channel names, kept free of any runtime dependency (no zod, no electron)
 * so `preload.ts` can import them without dragging the router's schema code into
 * the privileged preload bundle. Single source of truth for both sides.
 */

/** The single request channel. Streaming (per-run topics) is the only exception. */
export const INVOKE_CHANNEL = "apiweave:invoke"
export const CLOUD_STATUS_CHANGED_CHANNEL = "apiweave:cloud-status-changed"

export function runProgressChannel(runId: string): string {
  return `apiweave:run-progress:${runId}`
}
