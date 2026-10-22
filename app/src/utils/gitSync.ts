import {
  CloudAlert,
  CloudCheck,
  CloudDownload,
  CloudUpload,
  HardDrive,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import type { GitSyncIntent, GitSyncKind, GitSyncView } from "../types";
import { describeGitError, remoteHost } from "./gitErrorMessages";

const READ_ONLY_EXPLANATION =
  "You can't push to this repo — your changes stay on this device. Retry tries the push again; Discard local changes loads the remote's version instead.";

const DIVERGED_EXPLANATION =
  "Both this device and the remote changed, and the merge was abandoned. Your changes stay on this device. Sync now combines the two again, or Discard local changes loads the remote's version instead.";

const MERGING_EXPLANATION =
  "Both this device and the remote changed, and some fields were changed differently in each. Those need your decision before the merge can finish; until then nothing is pushed and your changes stay on this device. Discard local changes loads the remote's version instead.";

const LOCAL_HISTORY_EXPLANATION =
  "Every change is committed to this workspace's history on this device. It isn't connected to a remote.";

/** The text colour each intent takes where no Button supplies one, as the design tokens spell it. */
export const GIT_SYNC_INTENT_TEXT: Readonly<Record<GitSyncIntent, string>> = {
  default: "text-text-muted dark:text-text-muted-dark",
  success: "text-status-success dark:text-[var(--aw-status-success)]",
  info: "text-status-info dark:text-[var(--aw-status-info)]",
  warning: "text-status-warning dark:text-[var(--aw-status-warning)]",
  error: "text-status-error dark:text-[var(--aw-status-error)]",
};

const plural = (count: number, one: string, other: string): string =>
  `${count} ${count === 1 ? one : other}`;

/**
 * What the workspace's primary action is called: Review merge while conflicts
 * wait, Retry when the last attempt got stuck or the host refused the push,
 * otherwise Sync now — Commit now when there is no remote to sync with.
 */
export function gitSyncPrimaryLabel(status: WorkspaceGitStatus): string {
  if (status.state === "merging") return "Review merge";
  if (status.state === "diverged" || status.state === "error" || status.readOnly) return "Retry";
  return status.remoteUrl === null ? "Commit now" : "Sync now";
}

/** What happens to edits that are waiting, which is the one thing the mode decides; manual mode's button is named for what it does. */
function whenCommitted(status: WorkspaceGitStatus): string {
  if (status.mode === "auto") return "APIWeave commits them about 30 seconds after your last edit.";
  return `${status.remoteUrl === null ? "Commit now" : "Sync now"} commits them.`;
}

/** What happens to commits the remote doesn't have yet. */
const WHEN_PUSHED: Readonly<Record<WorkspaceGitStatus["mode"], string>> = {
  auto: "APIWeave pushes them on the next sync.",
  manual: "Sync now pushes them.",
};

/** A view with the fields most states leave empty. */
function view(
  kind: GitSyncKind,
  label: string,
  intent: GitSyncIntent,
  icon: LucideIcon | null,
  explanation: string,
  extra: Partial<Pick<GitSyncView, "detail" | "needsAuthor">> = {},
): GitSyncView {
  return { kind, label, intent, icon, explanation, detail: null, needsAuthor: false, ...extra };
}

/** The remote's host, or what to call it when the URL names none. */
const whereOf = (status: WorkspaceGitStatus): string =>
  remoteHost(status.remoteUrl) ?? "the remote";

/** Nothing to report: the header shows no control, and the switcher keeps the row's own tile. */
function untrackedView(): GitSyncView {
  return view("untracked", "Not tracked", "default", null, "");
}

function syncingView(status: WorkspaceGitStatus): GitSyncView {
  return status.remoteUrl === null
    ? view("syncing", "Committing", "info", RefreshCw, "Committing your changes to this workspace's history…")
    : view("syncing", "Syncing", "info", RefreshCw, `Syncing with ${whereOf(status)}…`);
}

/**
 * A merge waiting for the user to settle its conflicts: not "syncing", because
 * no pass will finish it. A merge that is simply waiting carries no error; any
 * `lastError` is why the last resolve stopped — git's text, or the app's own
 * (an import the merged tree failed, a merge that kept seeing new edits) — and
 * is the detail, except a missing author, which asks for one instead.
 */
function mergingView(status: WorkspaceGitStatus): GitSyncView {
  const { lastError } = status;
  const needsAuthor = lastError?.code === "identity_missing";
  return view("attention", "Merge needed", "warning", CloudAlert, MERGING_EXPLANATION, {
    needsAuthor,
    detail: lastError !== null && !needsAuthor ? lastError.message : null,
  });
}

function divergedView(status: WorkspaceGitStatus): GitSyncView {
  const { lastError } = status;
  // A cycle that could not even reach the remote keeps the divergence, with its own reason.
  const lastAttempt =
    lastError !== null && lastError.code !== null
      ? ` Last attempt: ${describeGitError(lastError, status.remoteUrl)}`
      : "";
  return view("attention", "Diverged", "warning", CloudAlert, `${DIVERGED_EXPLANATION}${lastAttempt}`);
}

function errorView(status: WorkspaceGitStatus): GitSyncView {
  const { lastError } = status;
  const label = status.remoteUrl === null ? "Commit error" : "Sync error";
  if (lastError === null) {
    return view("error", label, "error", CloudAlert, "The last sync didn't finish — retry.");
  }
  const needsAuthor = lastError.code === "identity_missing";
  return view("error", label, "error", CloudAlert, describeGitError(lastError, status.remoteUrl), {
    needsAuthor,
    // A missing author is fully explained, and git's text for it is not help.
    detail: lastError.code !== null && !needsAuthor ? lastError.message : null,
  });
}

/**
 * A refused push outlives the failures that follow it, and what it offers
 * (Discard) is still the way out, so the read-only explanation stays when a
 * later sync also failed: that failure is told after it, and git's text for
 * it is the detail.
 */
function readOnlyView(status: WorkspaceGitStatus): GitSyncView {
  const { lastError } = status;
  const failedSince =
    status.state === "error" && lastError !== null && lastError.code !== "permission_denied"
      ? ` The last sync also failed: ${describeGitError(lastError, status.remoteUrl)}`
      : "";
  const needsAuthor = status.state === "error" && lastError?.code === "identity_missing";
  return view("attention", "Read-only", "warning", CloudAlert, `${READ_ONLY_EXPLANATION}${failedSince}`, {
    needsAuthor,
    detail: lastError !== null && lastError.code !== null && !needsAuthor ? lastError.message : null,
  });
}

function incomingView(status: WorkspaceGitStatus): GitSyncView {
  const { incoming } = status;
  const waiting = `${plural(incoming, "new commit is", "new commits are")} waiting on ${whereOf(status)}. Sync now brings ${incoming === 1 ? "it" : "them"} in.`;
  const explanation = status.uncommitted
    ? `${waiting} You also have edits that aren't committed yet.`
    : waiting;
  return view("pending", `Incoming (${incoming})`, "info", CloudDownload, explanation);
}

function pendingView(status: WorkspaceGitStatus): GitSyncView {
  const { outgoing, uncommitted, mode, remoteUrl } = status;
  const unsaved = uncommitted
    ? `You have edits that aren't committed yet. ${whenCommitted(status)}`
    : null;
  const unpushed =
    outgoing > 0
      ? `${plural(outgoing, "commit hasn't", "commits haven't")} been pushed to the remote yet. ${WHEN_PUSHED[mode]}`
      : null;
  // The count is the one known without writing the workspace out: commits, not edited records.
  const label =
    remoteUrl === null
      ? "Local history · uncommitted"
      : !uncommitted && outgoing > 0
        ? `Pending (${outgoing} to push)`
        : "Pending";
  // A workspace with no remote keeps the local icon: its edits are going into this device's history, not a cloud.
  return view("pending", label, "info", remoteUrl === null ? HardDrive : CloudUpload, [unsaved, unpushed].filter(Boolean).join(" "));
}

function settledView(status: WorkspaceGitStatus): GitSyncView {
  return status.remoteUrl === null
    ? view("local", "Local history", "default", HardDrive, LOCAL_HISTORY_EXPLANATION)
    : view("synced", "Synced", "success", CloudCheck, `This workspace matches ${whereOf(status)}.`);
}

/**
 * How a workspace's sync status reads. One state wins, most urgent first: a
 * cycle running, a divergence, a refused push (with any failure since told as
 * part of it), another failure, incoming changes (manual mode only — auto
 * mode brings them in itself), local work not yet committed or pushed, and
 * last, in sync. This is the one mapping every surface uses; the kind is the
 * plan's coarse vocabulary, the label the exact state, and the icon and intent
 * follow the kind. A workspace with no remote says "Local history", never
 * "Synced", and has no push to describe.
 */
export function describeGitSync(status: WorkspaceGitStatus): GitSyncView {
  if (!status.tracked) return untrackedView();
  if (status.state === "merging") return mergingView(status);
  if (status.state === "syncing") return syncingView(status);
  if (status.state === "diverged") return divergedView(status);
  if (status.readOnly) return readOnlyView(status);
  if (status.state === "error") return errorView(status);
  if (status.mode === "manual" && status.incoming > 0) return incomingView(status);
  if (status.uncommitted || status.outgoing > 0) return pendingView(status);
  return settledView(status);
}
