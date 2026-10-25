import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitAccount } from "@shared/types/GitAccount";
import type { GitRepository } from "@shared/types/GitRepository";
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import type { GitRepositoryDraft } from "../../types";
import { installGitBridge, trackedStatus } from "../../__tests__/gitFixtures";
import { syncNewWorkspace } from "./CreateWorkspaceModal";

const ACCOUNT: GitAccount = {
  provider: "github",
  host: "github.com",
  login: "octo",
  gitProtocol: "https",
  active: true,
  problem: null,
};

const DRAFT: GitRepositoryDraft = {
  account: ACCOUNT,
  owner: "octo",
  name: "shop-api",
  private: true,
};

const REPOSITORY: GitRepository = {
  owner: "octo",
  name: "shop-api",
  fullName: "octo/shop-api",
  httpsUrl: "https://github.com/octo/shop-api.git",
  sshUrl: "git@github.com:octo/shop-api.git",
  private: true,
  empty: true,
  canPush: true,
};

/** A bridge whose workspace tracks and whose repository is created; only the connect answers differ. */
function bridgeWith(connect: () => Promise<WorkspaceGitStatus>): void {
  installGitBridge(trackedStatus(), {
    track: vi.fn(async () => trackedStatus()),
    createRepository: vi.fn(async () => ({ repository: REPOSITORY, problem: null })),
    connectRemote: vi.fn(connect),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("syncNewWorkspace", () => {
  it("finishes once the workspace is tracked, the repository created and the two joined", async () => {
    bridgeWith(async () => trackedStatus());

    await expect(syncNewWorkspace("ws-1", ACCOUNT, DRAFT)).resolves.toEqual({
      failure: null,
      note: null,
      identityMissing: false,
      mergeWaiting: false,
    });
  });

  it("reports a merge waiting rather than a sync that finished", async () => {
    bridgeWith(async () => trackedStatus({ state: "merging", unrelatedHistory: true }));

    await expect(syncNewWorkspace("ws-1", ACCOUNT, DRAFT)).resolves.toEqual({
      failure: null,
      note: null,
      identityMissing: false,
      mergeWaiting: true,
    });
  });

  it("reports a connect that bound the remote but could not prepare the merge as a failure, not a sync", async () => {
    bridgeWith(async () =>
      trackedStatus({
        state: "error",
        lastError: { code: null, message: "The remote copy's workspace.json is missing" },
      }),
    );

    await expect(syncNewWorkspace("ws-1", ACCOUNT, DRAFT)).resolves.toEqual({
      failure: "The remote copy's workspace.json is missing",
      note: null,
      identityMissing: false,
      mergeWaiting: false,
    });
  });
});
