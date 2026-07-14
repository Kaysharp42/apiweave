import { describe, expect, it, vi } from "vitest"
import { IpcRouter } from "../../router"
import { registerCloudHandlers } from "../cloud"
import type { CloudBindWorkspaceInput, CloudLinkInput, CloudSyncControl, CloudSyncStatus } from "../../../services/cloud_sync_control"

class FakeCloudSyncControl implements CloudSyncControl {
  public readonly linkSpy = vi.fn<(input: CloudLinkInput) => Promise<CloudSyncStatus>>()
  public readonly bindSpy = vi.fn<(input: CloudBindWorkspaceInput) => CloudSyncStatus>()
  private current: CloudSyncStatus = {
    linked: false,
    active: false,
    state: "idle",
    deadLetterCount: 0,
    workspaceIds: [],
  }

  public status(): CloudSyncStatus {
    return this.current
  }

  public async link(input: CloudLinkInput): Promise<CloudSyncStatus> {
    this.current = {
      linked: true,
      active: (input.workspaceIds?.length ?? 0) > 0,
      state: "idle",
      deadLetterCount: 0,
      deviceId: "device-1",
      workspaceIds: input.workspaceIds ?? [],
    }
    await this.linkSpy(input)
    return this.current
  }

  public cancelLink(): CloudSyncStatus {
    return this.current
  }

  public unlink(): CloudSyncStatus {
    this.current = { linked: false, active: false, state: "idle", deadLetterCount: 0, workspaceIds: [] }
    return this.current
  }

  public bindWorkspace(input: CloudBindWorkspaceInput): CloudSyncStatus {
    this.current = {
      linked: this.current.linked,
      active: this.current.linked,
      state: "idle",
      deadLetterCount: this.current.deadLetterCount,
      ...(this.current.deviceId !== undefined ? { deviceId: this.current.deviceId } : {}),
      workspaceIds: [...this.current.workspaceIds, input.cloudWorkspaceId ?? input.workspaceId],
    }
    this.bindSpy(input)
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
        zitadelIssuer: "https://auth.example.test",
        desktopClientId: "desktop-client",
        apiBaseUrl: "https://api.example.test",
        deviceLabel: "Test Device",
        workspaceIds: ["workspace-1"],
      },
    })
    expect(linked).toMatchObject({ ok: true, data: { linked: true, active: true, deviceId: "device-1" } })

    const bound = await router.dispatch({
      domain: "cloud",
      action: "bindWorkspace",
      payload: { workspaceId: "workspace-2", cloudWorkspaceId: "cloud-workspace-2" },
    })
    expect(bound).toMatchObject({ ok: true, data: { workspaceIds: ["workspace-1", "cloud-workspace-2"] } })
    expect(cloud.bindSpy).toHaveBeenCalledWith({ workspaceId: "workspace-2", cloudWorkspaceId: "cloud-workspace-2" })
  })

  it("fails closed when cloud control is not installed", async () => {
    const router = new IpcRouter()
    registerCloudHandlers(router, {} as never)

    const result = await router.dispatch({ domain: "cloud", action: "status", payload: {} })
    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } })
  })
})
