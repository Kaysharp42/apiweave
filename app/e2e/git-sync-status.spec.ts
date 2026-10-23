import { expect, test, type Page } from "@playwright/test";
import {
  captureEvidence,
  DESKTOP_WORKSPACE,
  installDesktopIpc,
  navigateDesktop,
} from "./fixtures/desktop";

/**
 * The header's sync status control, in each of its states.
 *
 * Git has its own privileged bridge (`__APIWEAVE_GIT__`), separate from the IPC
 * one `installDesktopIpc` fakes, so the spec fakes that too: a status the page
 * can ask for, and `__pushGitStatus__` to announce a new one the way main does
 * when a cycle moves on. Each state is captured with its popover open, which is
 * where its explanation and actions are.
 */

interface FakeStatus {
  readonly workspaceId: string;
  readonly tracked: boolean;
  readonly mode: "auto" | "manual";
  readonly remoteUrl: string | null;
  readonly branch: string;
  readonly state: "idle" | "syncing" | "merging" | "diverged" | "error";
  readonly lastError: { readonly code: string | null; readonly message: string } | null;
  readonly readOnly: boolean;
  readonly incoming: number;
  readonly outgoing: number;
  readonly uncommitted: boolean;
  readonly lastSyncedAt: string | null;
  readonly lastCommit: { readonly sha: string; readonly subject: string; readonly authorDate: string } | null;
}

declare global {
  interface Window {
    __pushGitStatus__: (status: FakeStatus) => void;
  }
}

const SETTLED: FakeStatus = {
  workspaceId: DESKTOP_WORKSPACE.workspaceId,
  tracked: true,
  mode: "auto",
  remoteUrl: "https://github.com/acme/api-tests.git",
  branch: "main",
  state: "idle",
  lastError: null,
  readOnly: false,
  incoming: 0,
  outgoing: 0,
  uncommitted: false,
  lastSyncedAt: "2026-10-20T08:30:00.000Z",
  lastCommit: {
    sha: "3f9a2c1d8e7b",
    subject: "Update workflows/checkout--01JABC.json",
    authorDate: "2026-10-20T10:29:41+02:00",
  },
};

interface StateScenario {
  readonly name: string;
  readonly status: FakeStatus;
  readonly label: string;
  readonly explanation: RegExp;
}

const SCENARIOS: readonly StateScenario[] = [
  {
    name: "synced",
    status: SETTLED,
    label: "Synced",
    explanation: /This workspace matches github\.com/,
  },
  {
    name: "pending",
    status: { ...SETTLED, uncommitted: true, outgoing: 1 },
    label: "Pending",
    explanation: /You have edits that aren't committed yet/,
  },
  {
    name: "syncing",
    status: { ...SETTLED, state: "syncing" },
    label: "Syncing",
    explanation: /Syncing with github\.com/,
  },
  {
    name: "incoming",
    status: { ...SETTLED, mode: "manual", incoming: 3 },
    label: "Incoming (3)",
    explanation: /3 new commits are waiting on github\.com/,
  },
  {
    name: "diverged",
    status: {
      ...SETTLED,
      state: "diverged",
      incoming: 2,
      outgoing: 1,
      lastError: { code: null, message: "both sides changed" },
    },
    label: "Diverged",
    explanation: /Both this device and the remote changed, and the merge was abandoned/,
  },
  {
    name: "read-only",
    status: {
      ...SETTLED,
      readOnly: true,
      outgoing: 2,
      lastError: { code: "permission_denied", message: "remote: Permission to acme/api-tests.git denied to dev." },
    },
    label: "Read-only",
    explanation: /You can't push to this repo — your changes stay on this device/,
  },
  {
    name: "error",
    status: {
      ...SETTLED,
      state: "error",
      lastError: { code: "auth_failed", message: "fatal: Authentication failed for 'https://github.com/acme/api-tests.git/'" },
    },
    label: "Sync error",
    explanation: /Sign-in to github\.com failed — your credential manager will ask again on retry/,
  },
  {
    name: "local-history",
    status: { ...SETTLED, remoteUrl: null, lastSyncedAt: null },
    label: "Local history",
    explanation: /Every change is committed to this workspace's history on this device/,
  },
  {
    name: "local-history-uncommitted",
    status: { ...SETTLED, remoteUrl: null, lastSyncedAt: null, uncommitted: true },
    label: "Local history · uncommitted",
    explanation: /You have edits that aren't committed yet/,
  },
];

async function installGitBridge(page: Page, initial: FakeStatus): Promise<void> {
  await page.addInitScript((first) => {
    let current = first;
    const listeners = new Set<(status: unknown) => void>();
    window.__pushGitStatus__ = (status) => {
      current = status;
      listeners.forEach((listener) => listener(status));
    };
    window.__APIWEAVE_GIT__ = {
      status: async () => current,
      statusAll: async () => [current],
      track: async () => current,
      untrack: async () => current,
      setMode: async () => current,
      syncNow: async () => current,
      pendingChanges: async () => [
        { kind: "workflow", change: "added", name: "Checkout", path: "workflows/checkout--w1.json" },
        { kind: "workflow", change: "changed", name: "Login", path: "workflows/login--w2.json" },
        { kind: "environment", change: "deleted", name: "Staging", path: "environments/staging--e1.json" },
      ],
      connectRemote: async () => current,
      disconnectRemote: async () => current,
      discardLocalChanges: async () => current,
      openFromGit: async () => ({ kind: "opened", workspaceId: "x", slug: "x", name: "x", warnings: [] }),
      onStatusChanged: (callback: (status: unknown) => void) => {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
    } as unknown as typeof window.__APIWEAVE_GIT__;
  }, initial);
}

test.describe("git sync status", () => {
  for (const scenario of SCENARIOS) {
    test(`shows ${scenario.name} as an icon and a word, and explains it`, async ({ page }) => {
      await installDesktopIpc(page);
      await installGitBridge(page, scenario.status);
      await navigateDesktop(page, "/personal/personal/workflows");

      const control = page.getByRole("button", { name: `Version history: ${scenario.label}` });
      await expect(control).toBeVisible();
      // The word is on screen next to the icon, not only in the accessible name.
      await expect(control).toContainText(scenario.label);
      await expect(control.locator("svg")).toBeVisible();

      await control.click();
      await expect(page.getByText(scenario.explanation)).toBeVisible();
      await captureEvidence(page, `git-sync-${scenario.name}.png`);
    });
  }

  test("moves from one state to the next as statuses are announced", async ({ page }) => {
    await installDesktopIpc(page);
    await installGitBridge(page, SETTLED);
    await navigateDesktop(page, "/personal/personal/workflows");
    await expect(page.getByRole("button", { name: "Version history: Synced" })).toBeVisible();

    await page.evaluate((status) => window.__pushGitStatus__(status), SCENARIOS[2]!.status);
    await expect(page.getByRole("button", { name: "Version history: Syncing" })).toBeVisible();

    await page.evaluate((status) => window.__pushGitStatus__(status), SCENARIOS[5]!.status);
    await expect(page.getByRole("button", { name: "Version history: Read-only" })).toBeVisible();
  });

  test("in manual mode, Sync now lists the pending changes by name before it commits", async ({ page }) => {
    await installDesktopIpc(page);
    await installGitBridge(page, { ...SETTLED, mode: "manual", uncommitted: true });
    await navigateDesktop(page, "/personal/personal/workflows");

    await page.getByRole("button", { name: "Version history: Pending" }).click();
    await page.getByRole("button", { name: "Sync now" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Added workflow “Checkout”")).toBeVisible();
    await expect(dialog.getByText("Changed workflow “Login”")).toBeVisible();
    await expect(dialog.getByText("Deleted environment “Staging”")).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Commit message" })).toBeVisible();
    await captureEvidence(page, "git-sync-commit-dialog.png");
  });

  test("Discard local changes asks first, saying what is thrown away", async ({ page }) => {
    await installDesktopIpc(page);
    await installGitBridge(page, SCENARIOS[4]!.status);
    await navigateDesktop(page, "/personal/personal/workflows");

    await page.getByRole("button", { name: "Version history: Diverged" }).click();
    await page.getByRole("button", { name: "Discard local changes" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/Every local commit and every change not yet committed is thrown away/)).toBeVisible();
    await captureEvidence(page, "git-sync-discard-confirm.png");
  });

  test("a workspace that is not tracked has no sync control", async ({ page }) => {
    await installDesktopIpc(page);
    await installGitBridge(page, { ...SETTLED, tracked: false, remoteUrl: null });
    await navigateDesktop(page, "/personal/personal/workflows");

    await expect(page.getByRole("button", { name: "Tutorials" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Version history:/ })).toHaveCount(0);
  });
});
