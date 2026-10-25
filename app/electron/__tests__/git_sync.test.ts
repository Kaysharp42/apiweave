import { EventEmitter } from "node:events"
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron"
import { describe, expect, it, vi } from "vitest"
import type { GitMergePick } from "@shared/types/GitMergePick"
import type { GitAccountList } from "@shared/types/GitAccountList"
import type { HostCliService, HostCliSignInOptions } from "../../core/git/accounts/host_cli_service"
import type { GitSyncService } from "../../core/git/git_sync_service"
import { GIT_CHANNELS } from "../../core/ipc/channels"
import { GitSignIns, cancelSignInWhenDocumentGoes, registerGitHandlers, type GitSignInPorts } from "../git_sync"
type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

/**
 * The git handlers on a fake `ipcMain`, behind a guard that lets every sender
 * through, over a sync service that only records the call.
 */
const NO_PORTS: GitSignInPorts = { openExternal: async () => undefined, showPrompt: () => undefined, focus: () => undefined }

function handlersOf(gitSync: GitSyncService, hostCli = {} as HostCliService, ports = NO_PORTS): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const ipcMain = { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) } as unknown as IpcMain
  registerGitHandlers(ipcMain, (handler) => (_event, ...args) => handler(...args), gitSync, hostCli, ports)
  return handlers
}

function handlerOf(gitSync: GitSyncService, channel: string, hostCli?: HostCliService): Handler {
  const handler = handlersOf(gitSync, hostCli).get(channel)
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

describe("the git bridge's registration", () => {
  it("registers every git channel, each behind the trusted-sender guard", () => {
    const handlers = new Map<string, Handler>()
    const ipcMain = { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) } as unknown as IpcMain
    const refuse = (): never => {
      throw new Error("untrusted sender")
    }
    registerGitHandlers(ipcMain, () => refuse, {} as GitSyncService, {} as HostCliService, NO_PORTS)

    expect([...handlers.keys()].sort()).toEqual(Object.values(GIT_CHANNELS).sort())
    for (const [channel, handler] of handlers) {
      expect(() => handler({} as IpcMainInvokeEvent, "ws-1"), channel).toThrow("untrusted sender")
    }
  })
})

describe("the account a remote is reached as", () => {
  const ACCOUNT = { provider: "github", host: "github.com", login: "octo" }
  const URL = "https://github.com/acme/tests.git"

  it("reaches connectRemote, setAccount and openFromGit checked, and as null when the renderer names none", async () => {
    const connectRemote = vi.fn(async () => ({}))
    const setAccount = vi.fn(async () => ({}))
    const openFromGit = vi.fn(async () => ({}))
    const handlers = handlersOf({ connectRemote, setAccount, openFromGit } as unknown as GitSyncService)
    const call = (channel: string, ...args: unknown[]): unknown => handlers.get(channel)?.({} as IpcMainInvokeEvent, ...args)

    await call(GIT_CHANNELS.connectRemote, "ws-1", URL, ACCOUNT)
    await call(GIT_CHANNELS.connectRemote, "ws-1", URL)
    await call(GIT_CHANNELS.setAccount, "ws-1", null)
    await call(GIT_CHANNELS.openFromGit, URL, ACCOUNT)

    expect(connectRemote.mock.calls).toEqual([
      ["ws-1", URL, ACCOUNT],
      ["ws-1", URL, null],
    ])
    expect(setAccount).toHaveBeenCalledWith("ws-1", null)
    expect(openFromGit).toHaveBeenCalledWith(URL, ACCOUNT)
  })

  it.each([
    { what: "a login that would read as an option", account: { ...ACCOUNT, login: "--upload-pack=x" } },
    { what: "a host with a path", account: { ...ACCOUNT, host: "github.com/evil" } },
    { what: "an unknown provider", account: { ...ACCOUNT, provider: "bitbucket" } },
    { what: "a token riding along", account: { ...ACCOUNT, token: "gho_x" } },
    { what: "something that is not an account", account: "octo" },
  ])("refuses $what before the sync service sees it", async ({ account }) => {
    const connectRemote = vi.fn(async () => ({}))
    const setAccount = vi.fn(async () => ({}))
    const handlers = handlersOf({ connectRemote, setAccount } as unknown as GitSyncService)

    await expect(async () => handlers.get(GIT_CHANNELS.connectRemote)?.({} as IpcMainInvokeEvent, "ws-1", URL, account)).rejects.toThrow()
    await expect(async () => handlers.get(GIT_CHANNELS.setAccount)?.({} as IpcMainInvokeEvent, "ws-1", account)).rejects.toThrow()

    expect(connectRemote).not.toHaveBeenCalled()
    expect(setAccount).not.toHaveBeenCalled()
  })
})

describe("signing in", () => {
  const ACCOUNT = { provider: "github" as const, host: "github.com", login: "octo" }
  const PAGE = "https://github.com/login/device"

  /** A host CLI whose sign-in prints its code when told to, and finishes when told to. */
  function pendingSignIn() {
    let options: HostCliSignInOptions | undefined
    let finish: (() => void) | undefined
    const signIn = vi.fn(
      (_provider: string, _host: string, given: HostCliSignInOptions) =>
        new Promise<typeof ACCOUNT>((resolve, reject) => {
          options = given
          finish = () => resolve(ACCOUNT)
          given.signal?.addEventListener("abort", () => reject(new Error("Sign-in was cancelled.")))
        }),
    )
    const ports = { openExternal: vi.fn(async () => undefined), showPrompt: vi.fn(), focus: vi.fn() }
    const signIns = new GitSignIns({ signIn } as unknown as HostCliService, ports)
    return {
      signIns,
      signIn,
      ports,
      prompt: () => options?.onPrompt({ code: "3F2A-9C1B", url: PAGE }),
      finish: () => finish?.(),
      signal: () => options?.signal,
    }
  }

  it("shows the code, opens the page the tool printed, reopens only that page, and brings the app back when done", async () => {
    const run = pendingSignIn()
    const signedIn = run.signIns.signIn("github", "github.com")
    run.signIns.openPage()
    expect(run.ports.openExternal).not.toHaveBeenCalled()

    run.prompt()
    run.signIns.openPage()

    expect(run.ports.showPrompt).toHaveBeenCalledWith({ provider: "github", host: "github.com", code: "3F2A-9C1B", url: PAGE })
    expect(run.ports.openExternal.mock.calls).toEqual([[PAGE], [PAGE]])
    run.finish()
    await expect(signedIn).resolves.toEqual(ACCOUNT)
    expect(run.ports.focus).toHaveBeenCalledOnce()
    run.signIns.openPage()
    expect(run.ports.openExternal).toHaveBeenCalledTimes(2)
  })

  it("cancels by aborting the tool, and resolves the cancel once the tool has gone", async () => {
    const run = pendingSignIn()
    const first = run.signIns.signIn("github", "github.com")
    const firstSignal = run.signal()

    const cancelled = run.signIns.cancel()

    expect(firstSignal?.aborted).toBe(true)
    await expect(first).rejects.toThrow("cancelled")
    await expect(cancelled).resolves.toBeUndefined()
    expect(run.ports.focus).not.toHaveBeenCalled()
  })

  it("lets a new sign-in replace one still waiting — a reloaded window's — rather than lock it out", async () => {
    const run = pendingSignIn()
    const abandoned = run.signIns.signIn("github", "github.com")
    const abandonedSignal = run.signal()

    const second = run.signIns.signIn("gitlab", "gitlab.com")

    await expect(abandoned).rejects.toThrow("cancelled")
    expect(abandonedSignal?.aborted).toBe(true)
    await vi.waitFor(() => expect(run.signIn).toHaveBeenCalledTimes(2))
    expect(run.signal()?.aborted).toBe(false)
    run.finish()
    await expect(second).resolves.toEqual(ACCOUNT)
  })

  it("stops a new sign-in before its tool starts when Cancel comes while the one it replaces is still exiting", async () => {
    // A tool that takes its time to exit once aborted, as a real taskkill does.
    const exits: (() => void)[] = []
    const signIn = vi.fn(
      (_provider: string, _host: string, given: HostCliSignInOptions) =>
        new Promise<typeof ACCOUNT>((_resolve, reject) => {
          given.signal?.addEventListener("abort", () => exits.push(() => reject(new Error("Sign-in was cancelled."))))
        }),
    )
    const signIns = new GitSignIns({ signIn } as unknown as HostCliService, NO_PORTS)
    const abandoned = signIns.signIn("github", "github.com").catch((error: unknown) => error)

    const replacement = signIns.signIn("github", "github.com").catch((error: unknown) => error)
    const cancelled = signIns.cancel()
    exits.forEach((exit) => exit())

    expect(await replacement).toMatchObject({ message: "Sign-in was cancelled." })
    await cancelled
    expect(await abandoned).toMatchObject({ message: "Sign-in was cancelled." })
    // The replacement's own tool never ran.
    expect(signIn).toHaveBeenCalledOnce()
  })

  it("refuses a provider or host it has no business with before any tool runs, and takes no page from the renderer", async () => {
    const run = pendingSignIn()
    const handlers = handlersOf({} as GitSyncService, { signIn: run.signIn } as unknown as HostCliService, run.ports)
    const call = (channel: string, ...args: unknown[]): unknown => handlers.get(channel)?.({} as IpcMainInvokeEvent, ...args)

    // Plain sentences for the dialog to show, never a zod error's JSON.
    await expect(async () => call(GIT_CHANNELS.signIn, "bitbucket", "bitbucket.org")).rejects.toThrow("APIWeave signs in to GitHub or GitLab only.")
    await expect(async () => call(GIT_CHANNELS.signIn, "github", "--hostname=evil")).rejects.toThrow(/^That is not a host name APIWeave can sign in to/)
    expect(run.signIn).not.toHaveBeenCalled()

    await call(GIT_CHANNELS.openSignInPage, "https://evil.example/")
    expect(run.ports.openExternal).not.toHaveBeenCalled()
  })
})

describe("cancelSignInWhenDocumentGoes", () => {
  function windowContents() {
    const contents = new EventEmitter()
    const cancel = vi.fn()
    cancelSignInWhenDocumentGoes(contents as unknown as Pick<WebContents, "on">, cancel)
    return { contents, cancel }
  }

  it("cancels when the window's document is replaced — a reload — or its renderer dies", () => {
    const reload = windowContents()
    reload.contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false })
    expect(reload.cancel).toHaveBeenCalledOnce()

    const crash = windowContents()
    crash.contents.emit("render-process-gone", {}, { reason: "crashed" })
    expect(crash.cancel).toHaveBeenCalledOnce()
  })

  it("leaves the sign-in alone for a navigation within the document, or in a sub-frame", () => {
    const { contents, cancel } = windowContents()
    contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true })
    contents.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false })
    expect(cancel).not.toHaveBeenCalled()
  })
})

describe("the listAccounts bridge", () => {
  it("answers with the accounts the host CLIs list", async () => {
    const list: GitAccountList = {
      clis: [{ provider: "github", command: "gh", missing: false, version: "2.97.0", problem: null }],
      accounts: [{ provider: "github", host: "github.com", login: "octo", gitProtocol: "https", active: true, problem: null }],
    }
    const listAccounts = vi.fn(async () => list)
    const handler = handlerOf({} as GitSyncService, GIT_CHANNELS.listAccounts, { listAccounts } as unknown as HostCliService)

    await expect(handler({} as IpcMainInvokeEvent)).resolves.toEqual(list)
  })
})

describe("the repository bridges", () => {
  const ACCOUNT = { provider: "github", host: "github.com", login: "octo" }
  const REQUEST = { owner: "octo", name: "api-tests", private: true }

  function repositoryHandlers() {
    const listOwners = vi.fn(async () => ({ owners: [], problem: null }))
    const createRepository = vi.fn(async () => ({}))
    const listRepositories = vi.fn(async () => ({ repositories: [], problems: [] }))
    const handlers = handlersOf({} as GitSyncService, { listOwners, createRepository, listRepositories } as unknown as HostCliService)
    const call = async (channel: string, ...args: unknown[]): Promise<unknown> => handlers.get(channel)?.({} as IpcMainInvokeEvent, ...args)
    return { listOwners, createRepository, listRepositories, call }
  }

  it("lists repositories for a checked account and two flags, and nothing else", async () => {
    const { listRepositories, call } = repositoryHandlers()

    await call(GIT_CHANNELS.listRepositories, ACCOUNT, { tagged: true, emptyOnly: false })
    await expect(call(GIT_CHANNELS.listRepositories, ACCOUNT, { tagged: true, emptyOnly: false, topic: "x" })).rejects.toThrow()
    await expect(call(GIT_CHANNELS.listRepositories, { ...ACCOUNT, login: "-x" }, { tagged: true, emptyOnly: false })).rejects.toThrow(
      "That is not an account APIWeave can sign in as.",
    )

    expect(listRepositories.mock.calls).toEqual([[ACCOUNT, { tagged: true, emptyOnly: false }]])
  })

  it("passes a checked account and request through to the host CLI service", async () => {
    const { listOwners, createRepository, call } = repositoryHandlers()

    await call(GIT_CHANNELS.listOwners, ACCOUNT)
    await call(GIT_CHANNELS.createRepository, ACCOUNT, REQUEST)

    expect(listOwners).toHaveBeenCalledWith(ACCOUNT)
    expect(createRepository).toHaveBeenCalledWith(ACCOUNT, REQUEST)
  })

  it.each([
    { what: "no account", account: null, request: REQUEST },
    { what: "an account carrying a token", account: { ...ACCOUNT, token: "gho_x" }, request: REQUEST },
    { what: "a name that reads as an option", account: ACCOUNT, request: { ...REQUEST, name: "--help" } },
    { what: "a name with a path in it", account: ACCOUNT, request: { ...REQUEST, name: "../../user" } },
    { what: "an owner that is not a name", account: ACCOUNT, request: { ...REQUEST, owner: "a b" } },
    { what: "a visibility that is not a flag", account: ACCOUNT, request: { ...REQUEST, private: "yes" } },
    { what: "a field the request does not have", account: ACCOUNT, request: { ...REQUEST, autoInit: true } },
  ])("refuses $what, in a plain sentence, before any tool runs", async ({ account, request }) => {
    const { listOwners, createRepository, call } = repositoryHandlers()

    await expect(call(GIT_CHANNELS.createRepository, account, request)).rejects.toThrow(/^That is not an? (account|repository) APIWeave can/)
    await expect(call(GIT_CHANNELS.listOwners, account === ACCOUNT ? "octo" : account)).rejects.toThrow("That is not an account APIWeave can sign in as.")

    expect(createRepository).not.toHaveBeenCalled()
    expect(listOwners).not.toHaveBeenCalled()
  })
})

describe("the mergeState bridge", () => {
  it("reads the merge for the workspace it is asked about", async () => {
    const state = { conflicts: [], picks: [PICK], notes: [] }
    const mergeState = vi.fn(async () => state)
    const handler = handlerOf({ mergeState } as unknown as GitSyncService, GIT_CHANNELS.mergeState)

    await expect(handler({} as IpcMainInvokeEvent, "ws-1")).resolves.toEqual(state)

    expect(mergeState).toHaveBeenCalledWith("ws-1")
  })

  it.each([
    { what: "a missing workspace id", workspaceId: undefined },
    { what: "an empty workspace id", workspaceId: "" },
    { what: "a workspace id that is not a string", workspaceId: 7 },
  ])("refuses $what before the sync service sees it", async ({ workspaceId }) => {
    const mergeState = vi.fn(async () => ({ conflicts: [], picks: [PICK], notes: [] }))
    const handler = handlerOf({ mergeState } as unknown as GitSyncService, GIT_CHANNELS.mergeState)
    const read = async (id: unknown): Promise<unknown> => handler({} as IpcMainInvokeEvent, id)

    await expect(read(workspaceId)).rejects.toThrow()

    expect(mergeState).not.toHaveBeenCalled()
  })
})

describe("the saveMergePicks bridge", () => {
  it("passes the decisions through, checked, for the workspace it is asked about", async () => {
    const state = { conflicts: [], picks: [PICK], notes: [] }
    const saveMergePicks = vi.fn(async () => state)
    const handler = handlerOf({ saveMergePicks } as unknown as GitSyncService, GIT_CHANNELS.saveMergePicks)

    await expect(handler({} as IpcMainInvokeEvent, "ws-1", [PICK])).resolves.toEqual(state)

    expect(saveMergePicks).toHaveBeenCalledWith("ws-1", [PICK])
  })

  it("refuses a decision that is not one, before the sync service sees it", async () => {
    const saveMergePicks = vi.fn(async () => ({ conflicts: [], picks: [], notes: [] }))
    const handler = handlerOf({ saveMergePicks } as unknown as GitSyncService, GIT_CHANNELS.saveMergePicks)
    const save = async (picks: unknown): Promise<unknown> => handler({} as IpcMainInvokeEvent, "ws-1", picks)

    await expect(save([{ recordId: "w1", path: "name" }])).rejects.toThrow(
      "That is not a merge decision APIWeave can read",
    )

    expect(saveMergePicks).not.toHaveBeenCalled()
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

  it("passes a value of the user's own through as a decision of its own", async () => {
    const { resolve, resolveMerge } = bridge()
    const own = { recordId: "wf-1", path: "description", value: { note: ["kept", true, null] } }

    await resolve([PICK, own])

    expect(resolveMerge).toHaveBeenCalledWith("ws-1", [PICK, own], {})
  })

  it("refuses a decision carrying both a copy and a value, in a sentence rather than zod's JSON", async () => {
    const { resolve, resolveMerge } = bridge()

    await expect(resolve([{ ...PICK, value: "both" }])).rejects.toThrow(
      "That is not a merge decision APIWeave can read: each decision names a record, a path in it, and either the copy to keep or a value of your own.",
    )

    expect(resolveMerge).not.toHaveBeenCalled()
  })

  it.each([
    { what: "a side that is neither copy", picks: [{ ...PICK, side: "mine" }] },
    { what: "a record id over 4096 characters", picks: [{ ...PICK, recordId: "x".repeat(4097) }] },
    { what: "an empty record id", picks: [{ ...PICK, recordId: "" }] },
    { what: "a path over 4096 characters", picks: [{ ...PICK, path: "p".repeat(4097) }] },
    { what: "a field the pick does not have", picks: [{ ...PICK, extra: true }] },
    { what: "neither a copy nor a value", picks: [{ recordId: "wf-1", path: "name" }] },
    { what: "more than 10,000 picks", picks: Array.from({ length: 10_001 }, () => PICK) },
    { what: "something that is not a list", picks: { 0: PICK } },
  ])("refuses $what before the sync service sees it", async ({ picks }) => {
    const { resolve, resolveMerge } = bridge()

    await expect(resolve(picks)).rejects.toThrow()

    expect(resolveMerge).not.toHaveBeenCalled()
  })
})
