import { describe, expect, it } from "vitest";
import {
  CloudAlert,
  CloudCheck,
  CloudDownload,
  CloudUpload,
  HardDrive,
  HardDriveUpload,
  RefreshCw,
} from "lucide-react";
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import { describeGitSync, gitSyncPrimaryLabel } from "./gitSync";
import { trackedStatus, untrackedStatus } from "../__tests__/gitFixtures";

const kindOf = (overrides: Partial<WorkspaceGitStatus>) => describeGitSync(trackedStatus(overrides)).kind;

const noRemote = { remoteUrl: null, lastSyncedAt: null } as const;

describe("describeGitSync", () => {
  it("is synced when nothing is waiting either way", () => {
    expect(describeGitSync(trackedStatus())).toMatchObject({
      kind: "synced",
      label: "Synced",
      intent: "success",
      icon: CloudCheck,
      explanation: "This workspace matches github.com.",
    });
  });

  it("is pending for uncommitted edits or unpushed commits, counting only the commits it knows", () => {
    expect(describeGitSync(trackedStatus({ uncommitted: true }))).toMatchObject({
      kind: "pending",
      label: "Pending",
      intent: "info",
      icon: CloudUpload,
    });
    expect(describeGitSync(trackedStatus({ outgoing: 3 }))).toMatchObject({ kind: "pending", label: "Pending (3 to push)" });
    expect(describeGitSync(trackedStatus({ outgoing: 3, uncommitted: true })).label).toBe("Pending");
  });

  it("tells auto and manual mode apart in what happens to waiting edits", () => {
    expect(describeGitSync(trackedStatus({ uncommitted: true, mode: "auto" })).explanation).toMatch(/about 30 seconds/);
    expect(describeGitSync(trackedStatus({ uncommitted: true, mode: "manual" })).explanation).toMatch(/Sync now commits them/);
    expect(describeGitSync(trackedStatus({ uncommitted: true, mode: "manual", remoteUrl: null })).explanation).toMatch(/Commit now commits them/);
  });

  it("says committed, not saved, so it never collides with the header's Save and auto-save", () => {
    for (const status of [
      trackedStatus({ uncommitted: true }),
      trackedStatus({ uncommitted: true, outgoing: 2 }),
      trackedStatus({ mode: "manual", incoming: 1, uncommitted: true }),
    ]) {
      expect(describeGitSync(status).explanation).not.toMatch(/\bsaved?\b|saves/i);
    }
  });

  it("names the primary action for the state", () => {
    const label = (overrides: Partial<WorkspaceGitStatus>) =>
      gitSyncPrimaryLabel(trackedStatus(overrides));

    expect(label({ state: "merging" })).toBe("Review merge");
    expect(label({ state: "diverged" })).toBe("Sync now");
    expect(label({ state: "error", lastError: { code: "timeout", message: "t" } })).toBe("Retry");
    expect(label({ readOnly: true })).toBe("Retry");
    expect(label({})).toBe("Sync now");
    expect(label(noRemote)).toBe("Commit now");
  });

  it("counts commits in the singular and the plural", () => {
    expect(describeGitSync(trackedStatus({ outgoing: 1 })).explanation).toMatch(/^1 commit hasn't been pushed to the remote yet/);
    expect(describeGitSync(trackedStatus({ outgoing: 2 })).explanation).toMatch(/^2 commits haven't been pushed to the remote yet/);
    expect(describeGitSync(trackedStatus({ mode: "manual", incoming: 1 })).explanation).toMatch(/^1 new commit is waiting on github\.com\. Sync now brings it in\./);
    expect(describeGitSync(trackedStatus({ mode: "manual", incoming: 3 })).explanation).toMatch(/^3 new commits are waiting on github\.com\. Sync now brings them in\./);
  });

  it("is incoming only in manual mode, and shows it as pending work", () => {
    expect(describeGitSync(trackedStatus({ mode: "manual", incoming: 2 }))).toMatchObject({
      kind: "pending",
      label: "Incoming (2)",
      intent: "info",
      icon: CloudDownload,
    });
    expect(kindOf({ mode: "auto", incoming: 2 })).toBe("synced");
  });

  it("names the stuck states, and puts the most urgent first", () => {
    expect(kindOf({ state: "syncing", readOnly: true, uncommitted: true })).toBe("syncing");
    expect(kindOf({ state: "diverged", readOnly: true })).toBe("attention");
    expect(kindOf({ state: "error", lastError: { code: "timeout", message: "t" } })).toBe("error");
    expect(kindOf({ readOnly: true, mode: "manual", incoming: 1 })).toBe("attention");
    expect(kindOf({ mode: "manual", incoming: 1, uncommitted: true })).toBe("pending");
  });

  it("keeps the read-only explanation when a later sync also failed, and tells the failure after it", () => {
    const view = describeGitSync(
      trackedStatus({ readOnly: true, state: "error", lastError: { code: "network_error", message: "fatal: unable to access" } }),
    );
    expect(view).toMatchObject({ kind: "attention", label: "Read-only", detail: "fatal: unable to access" });
    expect(view.explanation).toMatch(/^You can't push to this repo — your changes stay on this device\./);
    expect(view.explanation).toMatch(/The last sync also failed: Can't reach github\.com/);
    // The refusal itself is not a second failure.
    const refused = describeGitSync(
      trackedStatus({ readOnly: true, lastError: { code: "permission_denied", message: "remote: denied" } }),
    );
    expect(refused.explanation).not.toMatch(/also failed/);
  });

  it("explains a divergence and a read-only workspace in the plan's words", () => {
    expect(describeGitSync(trackedStatus({ state: "diverged" })).explanation).toMatch(
      /Both this device and the remote changed.*merge was abandoned.*Sync now combines/,
    );
    expect(describeGitSync(trackedStatus({ readOnly: true })).explanation).toMatch(/^You can't push to this repo — your changes stay on this device/);
  });

  it("says the copies share no history while a two-way merge waits, and after one is abandoned", () => {
    const waiting = describeGitSync(trackedStatus({ state: "merging", unrelatedHistory: true }));
    expect(waiting).toMatchObject({ kind: "attention", label: "Merge needed" });
    expect(waiting.explanation).toMatch(/^This device and the remote have no history in common/);
    expect(waiting.explanation).not.toMatch(/Both this device and the remote changed/);

    const abandoned = describeGitSync(trackedStatus({ state: "diverged", unrelatedHistory: true }));
    expect(abandoned).toMatchObject({ kind: "attention", label: "Diverged" });
    expect(abandoned.explanation).toMatch(/^This device and the remote have no history in common, and the merge was abandoned/);
    expect(abandoned.explanation).toMatch(/Sync now combines the two again/);
    expect(abandoned.explanation).not.toMatch(/Both this device and the remote changed/);
  });

  it("says a merge is needed, with no detail while it simply waits", () => {
    expect(describeGitSync(trackedStatus({ state: "merging", lastError: null }))).toMatchObject({
      kind: "attention",
      label: "Merge needed",
      intent: "warning",
      icon: CloudAlert,
      detail: null,
      needsAuthor: false,
    });
  });

  it("tells why a resolve stopped, whether the reason is git's or the app's, and asks for a missing author", () => {
    const git = describeGitSync(trackedStatus({ state: "merging", lastError: { code: "network_error", message: "fatal: unable to access" } }));
    expect(git).toMatchObject({ kind: "attention", detail: "fatal: unable to access", needsAuthor: false });

    const app = "This workspace changed again while the merge was being committed. Resolve the merge again to finish it.";
    expect(describeGitSync(trackedStatus({ state: "merging", lastError: { code: null, message: app } }))).toMatchObject({
      kind: "attention",
      detail: app,
    });

    const author = describeGitSync(trackedStatus({ state: "merging", lastError: { code: "identity_missing", message: "Author identity unknown" } }));
    expect(author).toMatchObject({ kind: "attention", needsAuthor: true, detail: null });
  });

  it("gives an error the message for its code, git's text as detail, and flags a missing author", () => {
    const view = describeGitSync(
      trackedStatus({ state: "error", lastError: { code: "network_error", message: "fatal: unable to access" } }),
    );
    expect(view).toMatchObject({
      kind: "error",
      label: "Sync error",
      intent: "error",
      icon: CloudAlert,
      detail: "fatal: unable to access",
      needsAuthor: false,
    });
    expect(view.explanation).toContain("Can't reach github.com");

    const author = describeGitSync(
      trackedStatus({ state: "error", lastError: { code: "identity_missing", message: "Author identity unknown" } }),
    );
    expect(author).toMatchObject({ needsAuthor: true, detail: null });
  });

  it("calls a local history local, not synced, and never mentions a push", () => {
    expect(describeGitSync(trackedStatus(noRemote))).toMatchObject({
      kind: "local",
      label: "Local history",
      intent: "muted",
      icon: HardDrive,
    });
    expect(describeGitSync(trackedStatus({ ...noRemote, uncommitted: true })).explanation).not.toMatch(/push|remote/i);
    expect(describeGitSync(trackedStatus({ ...noRemote, state: "syncing" }))).toMatchObject({ kind: "syncing", label: "Committing", icon: RefreshCw });
    expect(describeGitSync(trackedStatus({ ...noRemote, state: "error", lastError: { code: "command_failed", message: "x" } }))).toMatchObject({
      kind: "error",
      label: "Commit error",
    });
  });

  it("keeps a local history's uncommitted edits local, and says so", () => {
    const view = describeGitSync(trackedStatus({ ...noRemote, uncommitted: true }));
    // Upload, not the settled local shape: an icon-only row still tells the two apart.
    expect(view).toMatchObject({ kind: "pending", label: "Local history · uncommitted", intent: "info", icon: HardDriveUpload });
    expect(view.explanation).toMatch(/^You have edits that aren't committed yet\. APIWeave commits them about 30 seconds after your last edit\.$/);
    expect(describeGitSync(trackedStatus(noRemote)).icon).toBe(HardDrive);
  });

  it("reports nothing for an untracked workspace: the header has no control and the switcher keeps its tile", () => {
    expect(describeGitSync(untrackedStatus)).toMatchObject({ kind: "untracked", label: "Not tracked", intent: "muted", icon: null });
  });
});
