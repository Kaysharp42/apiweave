import { expect, test, type Page } from "@playwright/test";
import {
  captureEvidence,
  DESKTOP_WORKSPACE,
  installDesktopIpc,
  navigateDesktop,
} from "./fixtures/desktop";

/**
 * The merge view, opened from the header while a merge waits on conflicts.
 *
 * The fake git bridge holds a fixed conflict list, a note of what merged by
 * itself and the picks the view sends, so the flow is observable end to end:
 * what the inventory says, how a field is settled by a copy or by a value of
 * the user's own, and what a Finish carries. As with the status spec, git has
 * its own privileged bridge, separate from the IPC one.
 */

interface FakeStatus {
  readonly workspaceId: string;
  readonly tracked: boolean;
  readonly mode: "auto" | "manual";
  readonly remoteUrl: string | null;
  readonly branch: string;
  readonly account: { readonly provider: "github" | "gitlab"; readonly host: string; readonly login: string } | null;
  readonly state: "idle" | "syncing" | "merging" | "diverged" | "error";
  readonly lastError: { readonly code: string | null; readonly message: string } | null;
  readonly readOnly: boolean;
  readonly incoming: number;
  readonly outgoing: number;
  readonly uncommitted: boolean;
  readonly lastSyncedAt: string | null;
  readonly lastCommit: { readonly sha: string; readonly subject: string; readonly authorDate: string } | null;
  readonly unrelatedHistory: boolean;
}

interface FakeConflict {
  readonly kind: "workflow" | "file";
  readonly recordId: string;
  readonly name: string;
  readonly path: string;
  readonly base?: string;
  readonly ours?: string;
  readonly theirs?: string;
}

type FakePick =
  | { readonly recordId: string; readonly path: string; readonly side: "ours" | "theirs" }
  | { readonly recordId: string; readonly path: string; readonly value: string };

declare global {
  interface Window {
    __pushGitStatus__: (status: FakeStatus) => void;
    __gitPicks__: () => readonly FakePick[];
  }
}

const MERGING: FakeStatus = {
  workspaceId: DESKTOP_WORKSPACE.workspaceId,
  tracked: true,
  mode: "auto",
  remoteUrl: "https://github.com/acme/api-tests.git",
  branch: "main",
  account: null,
  state: "merging",
  lastError: { code: null, message: "Both this device and the remote changed. Resolve the conflicts to finish merging." },
  readOnly: false,
  incoming: 1,
  outgoing: 1,
  uncommitted: false,
  lastSyncedAt: "2026-10-19T09:00:00.000Z",
  lastCommit: {
    sha: "3f9a2c1d8e7b",
    subject: "Rename checkout on this device",
    authorDate: "2026-10-20T10:29:41+02:00",
  },
  unrelatedHistory: false,
};

const CONFLICTS: readonly FakeConflict[] = [
  {
    kind: "workflow",
    recordId: "w1",
    name: "Checkout",
    path: "name",
    base: "Checkout",
    ours: "Checkout (this device)",
    theirs: "Checkout (remote)",
  },
  {
    kind: "workflow",
    recordId: "w1",
    name: "Checkout",
    path: "description",
    base: "Pay by card",
    ours: "Pay by card, this device",
    theirs: "Pay by card, remote",
  },
  {
    kind: "file",
    recordId: "README.md",
    name: "README.md",
    path: "",
    base: "# API tests",
    ours: "# API tests (this device)",
    theirs: "# API tests (remote)",
  },
];

const NOTES = [
  { type: "positions" as const, recordId: "w1", name: "Checkout", nodeIds: ["n1"] },
];

const COMMIT = { authorDate: "2026-10-20T10:29:41+02:00" };

const COMMITS: Readonly<Record<string, { ours: object; theirs: object }>> = {
  w1: {
    ours: { ...COMMIT, sha: "b2b2b2b2b2b2", authorName: "Ada (this device)", subject: "Rename on this device" },
    theirs: { ...COMMIT, sha: "a1a1a1a1a1a1", authorName: "Grace (remote)", subject: "Rename on the remote" },
  },
  "README.md": {
    ours: { ...COMMIT, sha: "c3c3c3c3c3c3", authorName: "Ada (this device)", subject: "Update README on this device" },
    theirs: { ...COMMIT, sha: "d4d4d4d4d4d4", authorName: "Grace (remote)", subject: "Update README on the remote" },
  },
};

async function installGitBridge(page: Page, initial: FakeStatus): Promise<void> {
  await page.addInitScript(
    ({ first, conflicts, notes, commits }) => {
      let current = first;
      let listed = [...conflicts];
      let picks: FakePick[] = [];
      const listeners = new Set<(status: unknown) => void>();
      const announce = (next: FakeStatus): FakeStatus => {
        current = next;
        listeners.forEach((listener) => listener(next));
        return next;
      };
      window.__pushGitStatus__ = (status) => {
        announce(status);
      };
      window.__gitPicks__ = () => picks;
      window.__APIWEAVE_GIT__ = {
        status: async () => current,
        statusAll: async () => [current],
        track: async () => current,
        untrack: async () => current,
        setMode: async () => current,
        syncNow: async () => current,
        pendingChanges: async () => [],
        mergeState: async (_workspaceId: string, chosen?: readonly FakePick[]) => ({
          conflicts: listed,
          picks: [...(chosen ?? picks)],
          notes: [...notes],
        }),
        saveMergePicks: async (_workspaceId: string, chosen: readonly FakePick[]) => {
          picks = [...chosen];
          return { conflicts: listed, picks: [...picks], notes: [...notes] };
        },
        mergeRecordCommits: async (_workspaceId: string, recordIds: readonly string[]) =>
          recordIds.map((recordId) => ({ recordId, ...(commits[recordId] ?? { ours: null, theirs: null }) })),
        resolveMerge: async (_workspaceId: string, chosen: readonly FakePick[]) => {
          picks = [...chosen];
          listed = [];
          return announce({
            ...current,
            state: "idle",
            lastError: null,
            incoming: 0,
            outgoing: 0,
            lastCommit: {
              sha: "9e9e9e9e9e9e",
              subject: "Merge the remote's changes",
              authorDate: "2026-10-20T10:35:00+02:00",
            },
          });
        },
        abandonMerge: async () =>
          announce({
            ...current,
            state: "diverged",
            lastError: null,
            lastCommit: first.lastCommit,
          }),
        connectRemote: async () => current,
        disconnectRemote: async () => current,
        discardLocalChanges: async () => current,
        openFromGit: async () => ({ kind: "opened", workspaceId: "x", slug: "x", name: "x", warnings: [] }),
        // The header's accounts menu asks for these when it is opened.
        listAccounts: async () => ({ clis: [], accounts: [] }),
        listOwners: async () => ({ owners: [], problem: null }),
        listRepositories: async () => ({ repositories: [], problems: [] }),
        createRepository: async () => {
          throw new Error("not used by this spec");
        },
        onStatusChanged: (callback: (status: unknown) => void) => {
          listeners.add(callback);
          return () => listeners.delete(callback);
        },
      } as unknown as typeof window.__APIWEAVE_GIT__;
    },
    { first: initial, conflicts: CONFLICTS, notes: NOTES, commits: COMMITS },
  );
}

async function openMergeView(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Version history: Merge needed" }).click();
  await page.getByRole("button", { name: "Review merge" }).click();
}

test.describe("the merge view", () => {
  test("settles fields with copies and a value of the user's own, then finishes", async ({ page }) => {
    await installDesktopIpc(page);
    await installGitBridge(page, MERGING);
    await navigateDesktop(page, "/personal/personal/workflows");

    const control = page.getByRole("button", { name: "Version history: Merge needed" });
    await expect(control).toBeVisible();
    await openMergeView(page);

    const view = page.getByRole("dialog", { name: "Resolve merge" });
    await expect(view.getByText("Resolve merge")).toBeVisible();
    // The inventory: two records, three conflicts, nothing settled yet.
    await expect(view.getByRole("navigation", { name: "Conflicted items" })).toBeVisible();
    await expect(view.getByRole("button", { name: /Checkout, Workflows, 0 of 2 conflicts resolved/ })).toBeVisible();
    await expect(view.getByRole("button", { name: /README.md, Files, 0 of 1 conflicts resolved/ })).toBeVisible();
    await expect(view.getByRole("status")).toHaveText("0 of 3 conflicts resolved");
    // Both copies, with who last wrote each.
    await expect(view.getByText("Checkout (this device)")).toBeVisible();
    await expect(view.getByText("Checkout (remote)")).toBeVisible();
    await expect(view.getByText(/Your copy · Ada \(this device\) · b2b2b2b · 2026-10-20/)).toBeVisible();
    await expect(view.getByText(/Remote copy · Grace \(remote\) · a1a1a1a · 2026-10-20/)).toBeVisible();

    // A copy for one field.
    await view.getByRole("button", { name: "Take your copy of Name in Checkout" }).click();
    await expect(view.getByRole("status")).toHaveText("1 of 3 conflicts resolved");

    // A value of the user's own for another.
    const description = view.getByLabel("Result for Description in Checkout");
    await description.fill("Pay by card, agreed");
    await expect(view.getByRole("status")).toHaveText("2 of 3 conflicts resolved");
    await captureEvidence(page, "merge-view.png");

    // Closing stores the decisions; opening again starts where it left off.
    await view.getByRole("button", { name: "Close" }).click();
    await expect(view).toHaveCount(0);
    expect(await page.evaluate(() => window.__gitPicks__())).toEqual([
      { recordId: "w1", path: "description", value: "Pay by card, agreed" },
      { recordId: "w1", path: "name", side: "ours" },
    ]);
    await openMergeView(page);
    const reopened = page.getByRole("dialog", { name: "Resolve merge" });
    await expect(reopened.getByRole("status")).toHaveText("2 of 3 conflicts resolved");
    // The view opens on the first item with something left: the file. Checkout is settled.
    await reopened.getByRole("button", { name: /Checkout, Workflows, 2 of 2 conflicts resolved/ }).click();
    await expect(reopened.getByLabel("Result for Name in Checkout")).toHaveValue("Checkout (this device)");
    await expect(reopened.getByLabel("Result for Description in Checkout")).toHaveValue("Pay by card, agreed");

    // Clearing a value drops its decision: the conflict is back to unresolved.
    await reopened.getByLabel("Result for Description in Checkout").fill("");
    await expect(reopened.getByRole("status")).toHaveText("1 of 3 conflicts resolved");
    await expect(reopened.getByRole("button", { name: "Finish merge" })).toBeDisabled();
    await reopened.getByLabel("Result for Description in Checkout").fill("Pay by card, agreed");
    await expect(reopened.getByRole("status")).toHaveText("2 of 3 conflicts resolved");

    // What merged by itself, folded until asked.
    await reopened.getByRole("button", { name: "1 change merged automatically" }).click();
    await expect(reopened.getByText(/kept the remote copy's position for 1 node/)).toBeVisible();

    // The whole file: copies only.
    await reopened.getByRole("button", { name: /README.md, Files, 0 of 1 conflicts resolved/ }).click();
    await expect(reopened.getByLabel("Result for Whole file in README.md")).toHaveCount(0);
    await reopened.getByRole("button", { name: "Take the remote copy of Whole file in README.md" }).click();
    await expect(reopened.getByRole("status")).toHaveText("3 of 3 conflicts resolved");

    await reopened.getByRole("button", { name: "Finish merge" }).click();

    await expect(page.getByRole("dialog", { name: "Resolve merge" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Version history: Synced" })).toBeVisible();
    expect(await page.evaluate(() => window.__gitPicks__())).toEqual([
      { recordId: "README.md", path: "", side: "theirs" },
      { recordId: "w1", path: "description", value: "Pay by card, agreed" },
      { recordId: "w1", path: "name", side: "ours" },
    ]);
  });

  test("abandons the merge only after saying that the local commits are kept", async ({ page }) => {
    await installDesktopIpc(page);
    await installGitBridge(page, MERGING);
    await navigateDesktop(page, "/personal/personal/workflows");

    await openMergeView(page);

    const view = page.getByRole("dialog", { name: "Resolve merge" });
    await expect(view.getByText("Resolve merge")).toBeVisible();
    await view.getByRole("button", { name: "Abandon merge" }).click();

    const confirmation = page.getByRole("dialog", { name: "Abandon this merge?" });
    await expect(confirmation.getByText(/Every local commit and change stays on this device/)).toBeVisible();
    await captureEvidence(page, "merge-view-abandon.png");

    await confirmation.getByRole("button", { name: "Abandon merge" }).click();

    await expect(page.getByRole("dialog", { name: "Resolve merge" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Version history: Diverged" })).toBeVisible();
    expect(await page.evaluate(() => window.__gitPicks__())).toEqual([]);
  });

  test("says the copies share no history when the merge has no ancestor", async ({ page }) => {
    await installDesktopIpc(page);
    await installGitBridge(page, { ...MERGING, unrelatedHistory: true });
    await navigateDesktop(page, "/personal/personal/workflows");

    await openMergeView(page);

    const view = page.getByRole("dialog", { name: "Resolve merge" });
    await expect(
      view.getByText(/This device and the remote have no history in common, so every difference is listed/),
    ).toBeVisible();
  });
});
