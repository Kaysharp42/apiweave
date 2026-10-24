import { expect, test, type Page } from "@playwright/test";
import {
  captureEvidence,
  DESKTOP_WORKSPACE,
  installDesktopIpc,
  navigateDesktop,
} from "./fixtures/desktop";

/**
 * The merge picker, opened from the header while a merge waits on conflicts.
 *
 * The fake git bridge holds a fixed conflict list and records the picks the
 * picker sends, so the flow is observable end to end: what the dialog shows,
 * what a Finish carries, and what the header says afterwards. As with the
 * status spec, git has its own privileged bridge, separate from the IPC one.
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

interface FakePick {
  readonly recordId: string;
  readonly path: string;
  readonly side: "ours" | "theirs";
}

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
    ({ first, conflicts, commits }) => {
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
        mergeConflicts: async () => listed,
        mergePicks: async () => [...picks],
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
        onStatusChanged: (callback: (status: unknown) => void) => {
          listeners.add(callback);
          return () => listeners.delete(callback);
        },
      } as unknown as typeof window.__APIWEAVE_GIT__;
    },
    { first: initial, conflicts: CONFLICTS, commits: COMMITS },
  );
}

async function openPicker(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Version history: Merge needed" }).click();
  await page.getByRole("button", { name: "Review merge" }).click();
}

test.describe("git merge conflicts", () => {
  test("lists both copies of every conflict, with each side's author, and waits for every choice", async ({ page }) => {
    await installDesktopIpc(page);
    await installGitBridge(page, MERGING);
    await navigateDesktop(page, "/personal/personal/workflows");

    const control = page.getByRole("button", { name: "Version history: Merge needed" });
    await expect(control).toBeVisible();
    await control.click();
    await expect(page.getByText(/some fields were changed differently/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync now" })).toHaveCount(0);

    await page.getByRole("button", { name: "Review merge" }).click();

    const dialog = page.getByRole("dialog", { name: "Resolve merge" });
    // The dialog's root is a zero-sized wrapper around fixed-position content, so
    // the title is what proves it is on screen.
    await expect(dialog.getByText("Resolve merge")).toBeVisible();
    await expect(dialog.getByText("Checkout", { exact: true })).toBeVisible();
    await expect(dialog.getByText("README.md", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Checkout (this device)")).toBeVisible();
    await expect(dialog.getByText("Checkout (remote)")).toBeVisible();
    await expect(dialog.getByText("Pay by card, this device")).toBeVisible();
    await expect(dialog.getByText("Pay by card, remote")).toBeVisible();
    // Who touched each copy, from the merge's two commits.
    await expect(dialog.getByText(/Ada \(this device\) · b2b2b2b · 2026-10-20/)).toBeVisible();
    await expect(dialog.getByText(/Grace \(remote\) · a1a1a1a · 2026-10-20/)).toBeVisible();
    await expect(dialog.getByText("Rename on this device")).toBeVisible();
    await expect(dialog.getByText("Rename on the remote")).toBeVisible();
    // Never the merge's own words for the sides.
    await expect(dialog.getByText(/\bours\b/i)).toHaveCount(0);
    await expect(dialog.getByText(/\btheirs\b/i)).toHaveCount(0);

    // Nothing to finish until every place has a decision, including the file.
    const finish = dialog.getByRole("button", { name: "Finish merge" });
    await expect(finish).toBeDisabled();
    await captureEvidence(page, "git-sync-merge.png");

    await dialog
      .getByRole("button", { name: "Keep your copy of Name in Checkout" })
      .click();
    await dialog
      .getByRole("button", { name: "Keep remote copy of Description in Checkout" })
      .click();
    await expect(finish).toBeDisabled();
    await dialog
      .getByRole("button", {
        name: "Keep your copy for all conflicts in README.md",
      })
      .click();
    await expect(finish).toBeEnabled();
    await captureEvidence(page, "git-sync-merge-picked.png");

    await finish.click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Version history: Synced" })).toBeVisible();
    expect(await page.evaluate(() => window.__gitPicks__())).toEqual([
      { recordId: "README.md", path: "", side: "ours" },
      { recordId: "w1", path: "description", side: "theirs" },
      { recordId: "w1", path: "name", side: "ours" },
    ]);
  });

  test("abandons the merge only after saying that the local commits are kept", async ({ page }) => {
    await installDesktopIpc(page);
    await installGitBridge(page, MERGING);
    await navigateDesktop(page, "/personal/personal/workflows");

    await openPicker(page);

    const dialog = page.getByRole("dialog", { name: "Resolve merge" });
    await expect(dialog.getByText("Resolve merge")).toBeVisible();
    await dialog.getByRole("button", { name: "Abandon merge" }).click();

    const confirmation = page.getByRole("dialog", { name: "Abandon this merge?" });
    await expect(confirmation.getByText(/Every local commit and change stays on this device/)).toBeVisible();
    await captureEvidence(page, "git-sync-merge-abandon.png");

    await confirmation.getByRole("button", { name: "Abandon merge" }).click();

    await expect(page.getByRole("dialog", { name: "Resolve merge" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Version history: Diverged" })).toBeVisible();
    expect(await page.evaluate(() => window.__gitPicks__())).toEqual([]);
  });
});
