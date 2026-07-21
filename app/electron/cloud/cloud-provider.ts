/**
 * Cloud sync provider wiring — activates the CloudSyncProvider on desktop
 * startup after a successful device link, and handles IPC events for
 * workspace open and edit commits.
 *
 * Security invariants:
 * - All log lines redact tokens, codes, and ciphertext.
 * - Local-only workspaces (origin='local' AND syncMode='none') are skipped.
 * - No network calls from the renderer; all sync happens in the main process.
 * - The service locator seam (setSyncProvider) is used; no bypass.
 */

import type { IpcMain, WebContents } from "electron"
import { setSyncProvider } from "../../core/services-locator"
import type { WorkspaceOrigin } from "@shared/types/WorkspaceOrigin"
import type { WorkspaceSyncMode } from "@shared/types/WorkspaceSyncMode"
import {
  createCloudClient,
  CloudSyncProvider,
  type CloudClient,
  type DeviceTokenStore,
} from "./cloud-transport"
import type { CloudClientConfig } from "./cloud-client"
import { setState, getState, subscribe } from "./cloud-state"

// ─── IPC Channels ────────────────────────────────────────────────────────────

/** Renderer → main: a workspace was opened, trigger initial pull. */
export const WORKSPACE_OPENED_CHANNEL = "workspace:opened"

/** Renderer → main: an edit was committed, trigger debounced push. */
export const WORKSPACE_EDIT_COMMITTED_CHANNEL = "workspace:edit-committed"

/** Main → renderer: sync state changed (idle/syncing/conflict/error). */
export const CLOUD_SYNC_STATE_CHANNEL = "cloud:sync-state"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WorkspaceRef {
  readonly id: string
  readonly origin: WorkspaceOrigin
  readonly syncMode: WorkspaceSyncMode
}

export interface CloudSyncConfig {
  readonly tokenStore: DeviceTokenStore
  readonly client?: CloudClient // optional: inject for testing
  readonly clientConfig?: CloudClientConfig
}

// ─── State ───────────────────────────────────────────────────────────────────

let pushTimer: ReturnType<typeof setTimeout> | null = null
const PUSH_DEBOUNCE_MS = 2000

let activeProvider: CloudSyncProvider | null = null

// ─── Activation ──────────────────────────────────────────────────────────────

/**
 * Activate cloud sync: construct a CloudClient and CloudSyncProvider, then
 * register it via setSyncProvider(). Called from main.ts after initDatabase()
 * and a successful startDeviceLink().
 *
 * Returns the provider for testing; production code ignores the return.
 */
export function activateCloudSync(config: CloudSyncConfig): CloudSyncProvider {
  const client = config.client ?? createCloudClient(config.tokenStore, config.clientConfig)
  const provider = new CloudSyncProvider(client, (state) => {
    setState(state)
    // ponytail: log redacted state only, never tokens or payloads.
    console.info(`[cloud-sync] state=${state}`)
  })
  setSyncProvider(provider)
  activeProvider = provider
  setState("idle")
  return provider
}

/** Deactivate cloud sync and reset state. For tests and logout. */
export function deactivateCloudSync(): void {
  if (pushTimer !== null) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
  activeProvider = null
  setState("idle")
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

/**
 * Register IPC handlers for workspace:opened and workspace:edit-committed.
 * Also subscribes to sync state changes and emits them to the renderer.
 *
 * Called from main.ts after activateCloudSync().
 */
export function setupCloudIpc(ipcMain: IpcMain, webContents: () => WebContents | null): () => void {
  const unsubscribe = subscribe((state) => {
    const wc = webContents()
    if (wc && !wc.isDestroyed()) {
      wc.send(CLOUD_SYNC_STATE_CHANNEL, state)
    }
  })

  ipcMain.on(WORKSPACE_OPENED_CHANNEL, (_event, workspace: WorkspaceRef) => {
    void handleWorkspaceOpened(workspace)
  })

  ipcMain.on(WORKSPACE_EDIT_COMMITTED_CHANNEL, (_event, workspace: WorkspaceRef) => {
    handleEditCommitted(workspace)
  })

  return unsubscribe
}

// ─── Event Handlers ──────────────────────────────────────────────────────────

/**
 * Handle workspace:opened — pull if the workspace is not local-only.
 * Local-only workspaces (origin='local' AND syncMode='none') are skipped.
 */
export async function handleWorkspaceOpened(workspace: WorkspaceRef): Promise<void> {
  if (isLocalOnly(workspace)) {
    // ponytail: skip local-only workspaces, no sync transport calls.
    return
  }
  if (activeProvider === null) {
    console.warn("[cloud-sync] workspace:opened but provider not activated")
    return
  }
  try {
    await activeProvider.pull()
  } catch (err) {
    // State is already set to 'error' by the provider; log redacted.
    console.error(`[cloud-sync] pull failed: ${(err as Error).message}`)
  }
}

/**
 * Handle workspace:edit-committed — push with 2s debounce if the workspace
 * is not local-only. Rapid edits reset the timer.
 */
export function handleEditCommitted(workspace: WorkspaceRef): void {
  if (isLocalOnly(workspace)) {
    return
  }
  if (activeProvider === null) {
    console.warn("[cloud-sync] workspace:edit-committed but provider not activated")
    return
  }
  if (pushTimer !== null) {
    clearTimeout(pushTimer)
  }
  pushTimer = setTimeout(() => {
    pushTimer = null
    void activeProvider?.push().catch((err) => {
      console.error(`[cloud-sync] push failed: ${(err as Error).message}`)
    })
  }, PUSH_DEBOUNCE_MS)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Local-only workspace: origin='local' AND syncMode='none'. Skip sync. */
function isLocalOnly(workspace: WorkspaceRef): boolean {
  return workspace.origin === "local" && workspace.syncMode === "none"
}

// ─── Test Exports ────────────────────────────────────────────────────────────

/** For tests: get the current sync state. */
export { getState }

/** For tests: subscribe to state changes. */
export { subscribe }
