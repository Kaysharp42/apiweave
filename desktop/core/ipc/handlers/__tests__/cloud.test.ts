import { describe, expect, it, vi } from "vitest"
import { IpcRouter } from "../../router"
import { registerCloudHandlers } from "../cloud"
import {
  CloudUnlinkRequiresConfirmationError,
  type CloudBindWorkspaceInput,
  type CloudLinkInput,
  type CloudSyncControl,
  type CloudSyncStatus,
  type CloudUnlinkInput,
} from "../../../services/cloud_sync_control"

class FakeCloudSyncControl implements CloudSyncControl {
  public readonly linkSpy = vi.fn<(input: CloudLinkInput) => Promise<CloudSyncStatus>>()
  public readonly bindSpy = vi.fn<(input: CloudBindWorkspaceInput) => Promise<CloudSyncStatus>>()
  public readonly unlinkSpy = vi.fn<(input: CloudUnlinkInput) => Promise<void>>()
  private current: CloudSyncStatus = {
    linked: false,
    active: false,
    state: "idle",
    deadLetterCount: 0,
    workspaceIds: [],
    workspaceCatalog: [],
  }

  public status(): CloudSyncStatus {
    return this.current
  }

  public async link(input: CloudLinkInput): Promise<CloudSyncStatus> {
    this.current = {
      linked: true,
      active: false,
      state: "idle",
      deadLetterCount: 0,
      deviceId: "device-1",
      workspaceIds: [],
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
      state: "idle",
      deadLetterCount: 0,
      workspaceIds: [],
      workspaceCatalog: [],
    }
    return this.current
  }

  public async bindWorkspace(input: CloudBindWorkspaceInput): Promise<CloudSyncStatus> {
    this.current = {
      linked: this.current.linked,
      active: this.current.linked,
      state: "idle",
      deadLetterCount: this.current.deadLetterCount,
      ...(this.current.deviceId !== undefined ? { deviceId: this.current.deviceId } : {}),
      workspaceIds: [...this.current.workspaceIds, input.cloudWorkspaceId],
      workspaceCatalog: this.current.workspaceCatalog,
    }
    await this.bindSpy(input)
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

  it("fails closed when cloud control is not installed", async () => {
    const router = new IpcRouter()
    registerCloudHandlers(router, {} as never)

    const result = await router.dispatch({ domain: "cloud", action: "status", payload: {} })
    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } })
  })
})
