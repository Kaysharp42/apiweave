import { vi } from "vitest";
import type { GitBridge } from "@shared/types/GitBridge";
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";

export const untrackedStatus: WorkspaceGitStatus = {
  workspaceId: "ws-1",
  tracked: false,
  mode: "auto",
  remoteUrl: null,
  branch: "main",
  state: "idle",
  lastError: null,
  readOnly: false,
  incoming: 0,
  outgoing: 0,
  uncommitted: false,
  lastSyncedAt: null,
  lastCommit: null,
};

/** A tracked, connected, settled workspace; each test overrides what it is about. */
export const trackedStatus = (
  overrides: Partial<WorkspaceGitStatus> = {},
): WorkspaceGitStatus => ({
  ...untrackedStatus,
  tracked: true,
  remoteUrl: "https://github.com/acme/tests.git",
  lastSyncedAt: "2026-10-19T09:00:00.000Z",
  lastCommit: {
    sha: "abc1234def5678",
    subject: "Start tracking this workspace in APIWeave",
    authorDate: "2026-10-19T09:00:00+02:00",
  },
  ...overrides,
});

export interface InstalledGitBridge {
  readonly bridge: GitBridge;
  /** Push a status the way main's status-change channel does. */
  readonly push: (status: WorkspaceGitStatus) => void;
  /** How many `onStatusChanged` subscriptions are live. */
  readonly subscriptions: () => number;
}

/** Stub `window.__APIWEAVE_GIT__`; `overrides` replace single methods. */
export function installGitBridge(
  initial: WorkspaceGitStatus,
  overrides: Partial<GitBridge> = {},
): InstalledGitBridge {
  const listeners = new Set<(status: WorkspaceGitStatus) => void>();
  const bridge: GitBridge = {
    status: vi.fn(async () => initial),
    track: vi.fn(async () => trackedStatus()),
    untrack: vi.fn(async () => untrackedStatus),
    setMode: vi.fn(async (_workspaceId, mode) => trackedStatus({ mode })),
    syncNow: vi.fn(async () => trackedStatus()),
    pendingChanges: vi.fn(async () => []),
    connectRemote: vi.fn(async (_workspaceId, url) =>
      trackedStatus({ remoteUrl: url }),
    ),
    disconnectRemote: vi.fn(async () => trackedStatus({ remoteUrl: null })),
    discardLocalChanges: vi.fn(async () => trackedStatus()),
    openFromGit: vi.fn(async () => ({
      kind: "opened" as const,
      workspaceId: "ws-2",
      slug: "opened",
      name: "Opened",
      warnings: [],
    })),
    onStatusChanged: (callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    ...overrides,
  };
  vi.stubGlobal("__APIWEAVE_GIT__", bridge);
  return {
    bridge,
    push: (status) => listeners.forEach((listener) => listener(status)),
    subscriptions: () => listeners.size,
  };
}
