import { vi } from "vitest";
import type { GitBridge } from "@shared/types/GitBridge";
import type { GitSignInPrompt } from "@shared/types/GitSignInPrompt";
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";

export const untrackedStatus: WorkspaceGitStatus = {
  workspaceId: "ws-1",
  tracked: false,
  mode: "auto",
  remoteUrl: null,
  branch: "main",
  account: null,
  state: "idle",
  lastError: null,
  readOnly: false,
  incoming: 0,
  outgoing: 0,
  uncommitted: false,
  lastSyncedAt: null,
  lastCommit: null,
  unrelatedHistory: false,
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
  /** Push a sign-in's one-time code the way main's prompt channel does. */
  readonly prompt: (prompt: GitSignInPrompt) => void;
  /** How many `onStatusChanged` subscriptions are live. */
  readonly subscriptions: () => number;
}

/** Stub `window.__APIWEAVE_GIT__`; `overrides` replace single methods. */
export function installGitBridge(
  initial: WorkspaceGitStatus,
  overrides: Partial<GitBridge> = {},
): InstalledGitBridge {
  const listeners = new Set<(status: WorkspaceGitStatus) => void>();
  const promptListeners = new Set<(prompt: GitSignInPrompt) => void>();
  const bridge: GitBridge = {
    status: vi.fn(async () => initial),
    statusAll: vi.fn(async (): Promise<readonly WorkspaceGitStatus[]> =>
      initial.tracked ? [initial] : [],
    ),
    track: vi.fn(async () => trackedStatus()),
    untrack: vi.fn(async () => untrackedStatus),
    setMode: vi.fn(async (_workspaceId, mode) => trackedStatus({ mode })),
    syncNow: vi.fn(async () => trackedStatus()),
    pendingChanges: vi.fn(async () => []),
    mergeState: vi.fn(async () => ({ conflicts: [], picks: [], notes: [] })),
    saveMergePicks: vi.fn(async () => ({ conflicts: [], picks: [], notes: [] })),
    mergeRecordCommits: vi.fn(async (_workspaceId: string, recordIds: readonly string[]) =>
      recordIds.map((recordId: string) => ({ recordId, ours: null, theirs: null })),
    ),
    resolveMerge: vi.fn(async () => trackedStatus()),
    abandonMerge: vi.fn(async () => trackedStatus({ state: "diverged" })),
    connectRemote: vi.fn(async (_workspaceId, url, account) =>
      trackedStatus({ remoteUrl: url, account: account ?? null }),
    ),
    setAccount: vi.fn(async (_workspaceId, account) => trackedStatus({ account })),
    disconnectRemote: vi.fn(async () => trackedStatus({ remoteUrl: null })),
    discardLocalChanges: vi.fn(async () => trackedStatus()),
    openFromGit: vi.fn(async () => ({
      kind: "opened" as const,
      workspaceId: "ws-2",
      slug: "opened",
      name: "Opened",
      warnings: [],
    })),
    listAccounts: vi.fn(async () => ({ clis: [], accounts: [] })),
    signIn: vi.fn(async (provider, host) => ({ provider, host, login: "octo" })),
    cancelSignIn: vi.fn(async () => undefined),
    openSignInPage: vi.fn(async () => undefined),
    listOwners: vi.fn(async (account) => ({ owners: [{ path: account.login, kind: "user" as const }], problem: null })),
    listRepositories: vi.fn(async () => ({ repositories: [], problems: [] })),
    createRepository: vi.fn(async (_account, request) => ({
      repository: {
        owner: request.owner,
        name: request.name,
        fullName: `${request.owner}/${request.name}`,
        httpsUrl: `https://github.com/${request.owner}/${request.name}.git`,
        sshUrl: `git@github.com:${request.owner}/${request.name}.git`,
        private: request.private,
        empty: true,
        canPush: true,
      },
      problem: null,
    })),
    onSignInPrompt: (callback) => {
      promptListeners.add(callback);
      return () => {
        promptListeners.delete(callback);
      };
    },
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
    prompt: (prompt) => promptListeners.forEach((listener) => listener(prompt)),
    subscriptions: () => listeners.size,
  };
}
