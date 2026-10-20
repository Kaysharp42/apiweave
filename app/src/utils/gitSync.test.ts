import { describe, expect, it } from "vitest";
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import { describeGitSync, gitSyncPrimaryLabel } from "./gitSync";
import { trackedStatus } from "../__tests__/gitFixtures";

const kindOf = (overrides: Partial<WorkspaceGitStatus>) => describeGitSync(trackedStatus(overrides)).kind;

describe("describeGitSync", () => {
  it("is synced when nothing is waiting either way", () => {
    expect(describeGitSync(trackedStatus())).toMatchObject({
      kind: "synced",
      label: "Synced",
      explanation: "This workspace matches github.com.",
    });
  });

  it("is pending for uncommitted edits or unpushed commits, counting only the commits it knows", () => {
    expect(describeGitSync(trackedStatus({ uncommitted: true }))).toMatchObject({ kind: "pending", label: "Pending" });
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
    const label = (overrides: Partial<WorkspaceGitStatus>, connected = true) =>
      gitSyncPrimaryLabel(describeGitSync(trackedStatus(overrides)), connected);

    expect(label({ state: "merging" })).toBe("Review merge");
    expect(label({ state: "error", lastError: { code: "timeout", message: "t" } })).toBe("Retry");
    expect(label({ readOnly: true })).toBe("Retry");
    expect(label({})).toBe("Sync now");
    expect(label({ remoteUrl: null, lastSyncedAt: null }, false)).toBe("Commit now");
  });

  it("counts commits in the singular and the plural", () => {
    expect(describeGitSync(trackedStatus({ outgoing: 1 })).explanation).toMatch(/^1 commit hasn't been pushed to the remote yet/);
    expect(describeGitSync(trackedStatus({ outgoing: 2 })).explanation).toMatch(/^2 commits haven't been pushed to the remote yet/);
    expect(describeGitSync(trackedStatus({ mode: "manual", incoming: 1 })).explanation).toMatch(/^1 new commit is waiting on github\.com\. Sync now brings it in\./);
    expect(describeGitSync(trackedStatus({ mode: "manual", incoming: 3 })).explanation).toMatch(/^3 new commits are waiting on github\.com\. Sync now brings them in\./);
  });

  it("is incoming only in manual mode: auto mode brings changes in itself", () => {
    expect(describeGitSync(trackedStatus({ mode: "manual", incoming: 2 }))).toMatchObject({ kind: "incoming", label: "Incoming (2)" });
    expect(kindOf({ mode: "auto", incoming: 2 })).toBe("synced");
  });

  it("names the stuck states, and puts the most urgent first", () => {
    expect(kindOf({ state: "syncing", readOnly: true, uncommitted: true })).toBe("syncing");
    expect(kindOf({ state: "diverged", readOnly: true })).toBe("diverged");
    expect(kindOf({ state: "error", lastError: { code: "timeout", message: "t" } })).toBe("error");
    expect(kindOf({ readOnly: true, mode: "manual", incoming: 1 })).toBe("read-only");
    expect(kindOf({ mode: "manual", incoming: 1, uncommitted: true })).toBe("incoming");
  });

  it("keeps the read-only explanation when a later sync also failed, and tells the failure after it", () => {
    const view = describeGitSync(
      trackedStatus({ readOnly: true, state: "error", lastError: { code: "network_error", message: "fatal: unable to access" } }),
    );
    expect(view).toMatchObject({ kind: "read-only", label: "Read-only", detail: "fatal: unable to access" });
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

  it("gives an error the message for its code, git's text as detail, and flags a missing author", () => {
    const view = describeGitSync(
      trackedStatus({ state: "error", lastError: { code: "network_error", message: "fatal: unable to access" } }),
    );
    expect(view).toMatchObject({ kind: "error", label: "Sync error", detail: "fatal: unable to access", needsAuthor: false });
    expect(view.explanation).toContain("Can't reach github.com");

    const author = describeGitSync(
      trackedStatus({ state: "error", lastError: { code: "identity_missing", message: "Author identity unknown" } }),
    );
    expect(author).toMatchObject({ needsAuthor: true, detail: null });
  });

  it("says committed, not synced, and never mentions a push, for a workspace with no remote", () => {
    const local = { remoteUrl: null, lastSyncedAt: null };
    expect(describeGitSync(trackedStatus(local))).toMatchObject({ kind: "synced", label: "Committed" });
    expect(describeGitSync(trackedStatus({ ...local, uncommitted: true })).explanation).not.toMatch(/push|remote/i);
    expect(describeGitSync(trackedStatus({ ...local, state: "syncing" })).label).toBe("Committing");
    expect(describeGitSync(trackedStatus({ ...local, state: "error", lastError: { code: "command_failed", message: "x" } })).label).toBe("Commit error");
  });
});
