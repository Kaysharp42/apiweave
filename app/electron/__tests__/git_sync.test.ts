import type { IpcMain, IpcMainInvokeEvent } from "electron"
import { describe, expect, it, vi } from "vitest"
import type { GitMergePick } from "@shared/types/GitMergePick"
import type { GitSyncService } from "../../core/git/git_sync_service"
import { GIT_CHANNELS } from "../../core/ipc/channels"
import { registerGitHandlers } from "../git_sync"
type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

/**
 * The git handlers on a fake `ipcMain`, behind a guard that lets every sender
 * through, over a sync service that only records the call.
 */
function handlersOf(gitSync: GitSyncService): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const ipcMain = { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) } as unknown as IpcMain
  registerGitHandlers(ipcMain, (handler) => (_event, ...args) => handler(...args), gitSync)
  return handlers
}

function handlerOf(gitSync: GitSyncService, channel: string): Handler {
  const handler = handlersOf(gitSync).get(channel)
  if (handler === undefined) throw new Error(`${channel} is not registered`)
  return handler
}

function bridge(): { readonly resolve: (picks: unknown) => Promise<unknown>; readonly resolveMerge: ReturnType<typeof vi.fn> } {
  const resolveMerge = vi.fn(async () => ({ state: "idle" }))
  const handler = handlerOf({ resolveMerge } as unknown as GitSyncService, GIT_CHANNELS.resolveMerge)
  return {
    resolve: async (picks) => handler({} as IpcMainInvokeEvent, "ws-1", picks, {}),
    resolveMerge,
  }
}

const PICK: GitMergePick = { recordId: "wf-1", path: "name", side: "theirs" }

describe("the mergePicks bridge", () => {
  it("reads the stored decisions for the workspace it is asked about", async () => {
    const mergePicks = vi.fn(async () => [PICK])
    const handler = handlerOf({ mergePicks } as unknown as GitSyncService, GIT_CHANNELS.mergePicks)

    await expect(handler({} as IpcMainInvokeEvent, "ws-1")).resolves.toEqual([PICK])

    expect(mergePicks).toHaveBeenCalledWith("ws-1")
  })

  it.each([
    { what: "a missing workspace id", workspaceId: undefined },
    { what: "an empty workspace id", workspaceId: "" },
    { what: "a workspace id that is not a string", workspaceId: 7 },
  ])("refuses $what before the sync service sees it", async ({ workspaceId }) => {
    const mergePicks = vi.fn(async () => [PICK])
    const handler = handlerOf({ mergePicks } as unknown as GitSyncService, GIT_CHANNELS.mergePicks)
    const read = async (id: unknown): Promise<unknown> => handler({} as IpcMainInvokeEvent, id)

    await expect(read(workspaceId)).rejects.toThrow()

    expect(mergePicks).not.toHaveBeenCalled()
  })
})

describe("the statusAll bridge", () => {
  it("reads every tracked workspace's status without taking an argument", async () => {
    const statusAll = vi.fn(async () => [])
    const handler = handlerOf({ statusAll } as unknown as GitSyncService, GIT_CHANNELS.statusAll)

    await expect(handler({} as IpcMainInvokeEvent)).resolves.toEqual([])

    expect(statusAll).toHaveBeenCalledTimes(1)
  })
})

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
