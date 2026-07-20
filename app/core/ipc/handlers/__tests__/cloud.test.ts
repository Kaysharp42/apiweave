import { describe, expect, it, vi } from "vitest"
import { IpcRouter } from "../../router"
import { registerCloudHandlers } from "../cloud"
import {
  CloudAccountMismatchError,
  CloudUnlinkRequiresConfirmationError,
  type CloudBindWorkspaceInput,
  type CloudInitializeWorkspaceInput,
  type CloudLinkInput,
  type CloudSyncControl,
  type CloudSyncStatus,
  type CloudUnbindWorkspaceInput,
  type CloudUnlinkInput,
} from "../../../services/cloud_sync_control"

class FakeCloudSyncControl implements CloudSyncControl {
  public readonly linkSpy = vi.fn<(input: CloudLinkInput) => Promise<CloudSyncStatus>>()
  public readonly bindSpy = vi.fn<(input: CloudBindWorkspaceInput) => Promise<CloudSyncStatus>>()
  public readonly unlinkSpy = vi.fn<(input: CloudUnlinkInput) => Promise<void>>()
  public readonly unbindSpy = vi.fn<(input: CloudUnbindWorkspaceInput) => void>()
  public readonly refreshCatalogSpy = vi.fn<() => Promise<void>>()
  public readonly initializeSpy = vi.fn<(input: CloudInitializeWorkspaceInput) => Promise<void>>()
  private current: CloudSyncStatus = {
    linked: false,
    active: false,
    linkState: "unlinked",
    syncState: "idle",
    state: "idle",
    pendingCount: 0,
    deadLetterCount: 0,
    conflictCount: 0,
    workspaceIds: [],
    bindings: [],
    workspaceCatalog: [],
  }

  public status(): CloudSyncStatus {
    return this.current
  }

  public async link(input: CloudLinkInput): Promise<CloudSyncStatus> {
    this.current = {
      linked: true,
      active: false,
      linkState: "linked",
      syncState: "idle",
      state: "idle",
      pendingCount: 0,
      deadLetterCount: 0,
      conflictCount: 0,
      deviceId: "device-1",
      device: {
        deviceId: "device-1",
        label: "Test Device",
        clientVersion: "1.0.0",
        createdAt: "2026-07-16T00:00:00.000Z",
      },
      account: { accountId: "account-1", email: "test@example.com" },
      workspaceIds: [],
      bindings: [],
      workspaceCatalog: [{
        workspaceId: "cloud-workspace-2",
        workspaceName: "Personal",
        isPersonal: true,
        effectiveRole: 5,
        canPull: true,
        canPush: true,
        canResolveConflicts: true,
      }],
    }
    await this.linkSpy(input)
    return this.current
  }

  public cancelLink(): CloudSyncStatus {
    return this.current
  }

  public async unlink(input: CloudUnlinkInput): Promise<CloudSyncStatus> {
    await this.unlinkSpy(input)
    this.current = {
      linked: false,
      active: false,
      linkState: "unlinked",
      syncState: "idle",
      state: "idle",
      pendingCount: 0,
      deadLetterCount: 0,
      conflictCount: 0,
      workspaceIds: [],
      bindings: [],
      workspaceCatalog: [],
    }
    return this.current
  }

  public async bindWorkspace(input: CloudBindWorkspaceInput): Promise<CloudSyncStatus> {
    this.current = {
      linked: this.current.linked,
      active: this.current.linked,
      linkState: this.current.linkState,
      syncState: "idle",
      state: "idle",
      pendingCount: this.current.pendingCount,
      deadLetterCount: this.current.deadLetterCount,
      conflictCount: this.current.conflictCount,
      ...(this.current.deviceId !== undefined ? { deviceId: this.current.deviceId } : {}),
      ...(this.current.device !== undefined ? { device: this.current.device } : {}),
      ...(this.current.account !== undefined ? { account: this.current.account } : {}),
      workspaceIds: [...this.current.workspaceIds, input.cloudWorkspaceId],
      bindings: this.current.bindings,
      workspaceCatalog: this.current.workspaceCatalog,
    }
    await this.bindSpy(input)
    return this.current
  }

  public unbindWorkspace(input: CloudUnbindWorkspaceInput): CloudSyncStatus {
    this.unbindSpy(input)
    return this.current
  }

  public async initializeWorkspace(input: CloudInitializeWorkspaceInput): Promise<CloudSyncStatus> {
    await this.initializeSpy(input)
    return this.current
  }

  public async refreshWorkspaceCatalog(): Promise<CloudSyncStatus> {
    await this.refreshCatalogSpy()
    return this.current
  }

  public async pull(): Promise<CloudSyncStatus> {
    return this.current
  }

  public async push(): Promise<CloudSyncStatus> {
    return this.current
  }
}

describe("cloud IPC handlers", () => {
  it("exposes link/status/bind through the registry", async () => {
    const cloud = new FakeCloudSyncControl()
    const router = new IpcRouter()
    registerCloudHandlers(router, { cloud } as never)

    const linked = await router.dispatch({
      domain: "cloud",
      action: "link",
      payload: {
        deviceLabel: "Test Device",
      },
    })
    expect(linked).toMatchObject({
      ok: true,
      data: { linked: true, active: false, deviceId: "device-1", workspaceCatalog: [{ workspaceId: "cloud-workspace-2" }] },
    })

    const bound = await router.dispatch({
      domain: "cloud",
      action: "bindWorkspace",
      payload: { workspaceId: "workspace-2", cloudWorkspaceId: "cloud-workspace-2" },
    })
    expect(bound).toMatchObject({ ok: true, data: { workspaceIds: ["cloud-workspace-2"] } })
    expect(cloud.bindSpy).toHaveBeenCalledWith({ workspaceId: "workspace-2", cloudWorkspaceId: "cloud-workspace-2" })
  })

  it("rejects renderer-supplied cloud endpoints", async () => {
    const cloud = new FakeCloudSyncControl()
    const router = new IpcRouter()
    registerCloudHandlers(router, { cloud } as never)

    const result = await router.dispatch({
      domain: "cloud",
      action: "link",
      payload: { apiBaseUrl: "https://attacker.example" },
    })

    expect(result).toMatchObject({ ok: false, error: { code: "validation" } })
    expect(cloud.linkSpy).not.toHaveBeenCalled()
  })

  it("requires explicit confirmation when server revocation cannot be verified", async () => {
    const cloud = new FakeCloudSyncControl()
    cloud.unlinkSpy.mockRejectedValueOnce(new CloudUnlinkRequiresConfirmationError())
    const router = new IpcRouter()
    registerCloudHandlers(router, { cloud } as never)

    const result = await router.dispatch({ domain: "cloud", action: "unlink", payload: {} })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "conflict",
        details: { localOnlyConfirmationRequired: true },
      },
    })

    await router.dispatch({ domain: "cloud", action: "unlink", payload: { localOnly: true } })
    expect(cloud.unlinkSpy).toHaveBeenLastCalledWith({ localOnly: true })
  })

  it("exposes catalog refresh and unbind through validated registry actions", async () => {
    const cloud = new FakeCloudSyncControl()
    const router = new IpcRouter()
    registerCloudHandlers(router, { cloud } as never)

    const refreshed = await router.dispatch({
      domain: "cloud",
      action: "refreshWorkspaceCatalog",
      payload: {},
    })
    const unbound = await router.dispatch({
      domain: "cloud",
      action: "unbindWorkspace",
      payload: { workspaceId: "workspace-2" },
    })
    const initialized = await router.dispatch({
      domain: "cloud",
      action: "initializeWorkspace",
      payload: { workspaceId: "workspace-2" },
    })

    expect(refreshed).toMatchObject({ ok: true })
    expect(unbound).toMatchObject({ ok: true })
    expect(initialized).toMatchObject({ ok: true })
    expect(cloud.refreshCatalogSpy).toHaveBeenCalledOnce()
    expect(cloud.unbindSpy).toHaveBeenCalledWith({ workspaceId: "workspace-2" })
    expect(cloud.initializeSpy).toHaveBeenCalledWith({ workspaceId: "workspace-2" })
  })

  it("maps a different-account relink to a safe conflict response", async () => {
    const cloud = new FakeCloudSyncControl()
    cloud.linkSpy.mockRejectedValueOnce(new CloudAccountMismatchError())
    const router = new IpcRouter()
    registerCloudHandlers(router, { cloud } as never)

    const result = await router.dispatch({ domain: "cloud", action: "link", payload: {} })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "conflict",
        details: { accountMismatch: true, accountIdentityRequired: false },
      },
    })
  })

  it("fails closed when cloud control is not installed", async () => {
    const router = new IpcRouter()
    registerCloudHandlers(router, {} as never)

    const result = await router.dispatch({ domain: "cloud", action: "status", payload: {} })
    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } })
  })
})
