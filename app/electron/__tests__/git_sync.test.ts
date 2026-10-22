import type { IpcMain, IpcMainInvokeEvent } from "electron"
import { describe, expect, it, vi } from "vitest"
import type { GitMergePick } from "@shared/types/GitMergePick"
import type { GitSyncService } from "../../core/git/git_sync_service"
import { GIT_CHANNELS } from "../../core/ipc/channels"
import { registerGitHandlers } from "../git_sync"

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

/** The git handlers, registered on a fake `ipcMain` behind a guard that lets every sender through, over a sync service that only records its resolves. */
function bridge(): { readonly resolve: (picks: unknown) => Promise<unknown>; readonly resolveMerge: ReturnType<typeof vi.fn> } {
  const handlers = new Map<string, Handler>()
  const ipcMain = { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) } as unknown as IpcMain
  const resolveMerge = vi.fn(async () => ({ state: "idle" }))
  const gitSync = { resolveMerge } as unknown as GitSyncService
  registerGitHandlers(ipcMain, (handler) => (_event, ...args) => handler(...args), gitSync)
  const handler = handlers.get(GIT_CHANNELS.resolveMerge)
  if (handler === undefined) throw new Error("resolveMerge is not registered")
  return {
    resolve: async (picks) => handler({} as IpcMainInvokeEvent, "ws-1", picks, {}),
    resolveMerge,
  }
}

const PICK: GitMergePick = { recordId: "wf-1", path: "name", side: "theirs" }

describe("the resolveMerge bridge", () => {
  it("passes well-formed picks through to the sync service", async () => {
    const { resolve, resolveMerge } = bridge()

    await resolve([PICK, { recordId: "README.md", path: "", side: "ours" }])

    expect(resolveMerge).toHaveBeenCalledWith("ws-1", [PICK, { recordId: "README.md", path: "", side: "ours" }], {})
  })

  it.each([
    { what: "a side that is neither copy", picks: [{ ...PICK, side: "mine" }] },
    { what: "a record id over 4096 characters", picks: [{ ...PICK, recordId: "x".repeat(4097) }] },
    { what: "an empty record id", picks: [{ ...PICK, recordId: "" }] },
    { what: "a path over 4096 characters", picks: [{ ...PICK, path: "p".repeat(4097) }] },
    { what: "a field the pick does not have", picks: [{ ...PICK, extra: true }] },
    { what: "more than 10,000 picks", picks: Array.from({ length: 10_001 }, () => PICK) },
    { what: "something that is not a list", picks: { 0: PICK } },
  ])("refuses $what before the sync service sees it", async ({ picks }) => {
    const { resolve, resolveMerge } = bridge()

    await expect(resolve(picks)).rejects.toThrow()

    expect(resolveMerge).not.toHaveBeenCalled()
  })
})
