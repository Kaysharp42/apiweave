import { z } from "zod"
import type { IpcMainInvokeEvent, IpcMain, WebContents } from "electron"
import type { ContractResult } from "@shared/contract/errors"
import type { RunProgressEvent } from "@shared/types/RunProgressEvent"
import { IpcRouter } from "./router"
import { INVOKE_CHANNEL, runProgressChannel } from "./channels"

export { INVOKE_CHANNEL, runProgressChannel }

const invokeRequestSchema = z.object({
  domain: z.string().min(1),
  action: z.string().min(1),
  payload: z.unknown(),
})

export function emitRunProgress(webContents: WebContents, event: RunProgressEvent): void {
  webContents.send(runProgressChannel(event.runId), event)
}

/**
 * Only the app's own privileged document may drive the IPC bridge. Rejects a
 * renderer-created window or a navigated-away document even if it somehow
 * retained the preload (defense in depth alongside the main-process
 * navigation/window-open guards).
 */
export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const senderUrl = event.senderFrame?.url
  if (!senderUrl) return false
  try {
    return new URL(senderUrl).protocol === "app:"
  } catch {
    return false
  }
}

/**
 * Bolts the pure {@link IpcRouter} onto `ipcMain`. Kept `import type`-only on
 * `electron` so the module carries no runtime electron dependency and stays
 * importable from vitest. The renderer envelope is untrusted, so its outer shape
 * is zod-validated here before it ever reaches a handler.
 */
export function attachIpcRouter(ipcMain: IpcMain, router: IpcRouter): void {
  ipcMain.handle(INVOKE_CHANNEL, async (event, raw: unknown): Promise<ContractResult<unknown>> => {
    if (!isTrustedSender(event)) {
      return { ok: false, error: { code: "denied", message: "untrusted sender" } }
    }
    const parsed = invokeRequestSchema.safeParse(raw)
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: "validation", message: "malformed IPC request", details: parsed.error.issues },
      }
    }
    return router.dispatch({
      domain: parsed.data.domain,
      action: parsed.data.action,
      payload: parsed.data.payload,
    })
  })
}
