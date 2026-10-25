import { useEffect, useMemo, useState } from "react";
import type { GitMergeConflict } from "@shared/types/GitMergeConflict";
import type { GitMergeNote } from "@shared/types/GitMergeNote";
import type { GitMergePick } from "@shared/types/GitMergePick";
import type { GitMergeSide } from "@shared/types/GitMergeSide";
import type { MergeRecordCommits } from "@shared/types/MergeRecordCommits";
import type { WorkspaceGitCommitRequest } from "@shared/types/WorkspaceGitCommitRequest";
import type { WorkspaceGitError } from "@shared/types/WorkspaceGitError";
import { ConfirmDialog } from "../molecules/ConfirmDialog";
import { Modal } from "../molecules/Modal";
import { GitAuthorForm } from "./GitAuthorForm";
import { MergeViewBody } from "./MergeViewBody";
import { MergeViewFooter } from "./MergeViewFooter";
import { MergeViewHeader } from "./MergeViewHeader";
import { git } from "../../utils/apiweaveClient";
import {
  acceptAllPicks,
  allConflictsResolved,
  groupConflicts,
  nextUnresolved,
  pickKey,
  picksFromList,
  picksRequest,
  resolutionOf,
  resolvedCount,
  withSidePick,
  withValuePick,
  withWholeRecordPick,
  withoutResolvingPick,
} from "../../utils/mergePicks";
import { splitMergeCommitIds } from "../../utils/mergeCommits";
import type {
  GitMergeViewProps,
  MergeConflictGroup,
} from "../../types";

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Why a resolve left the merge waiting, in the user's terms; a missing author says where to set one. */
function mergeErrorText(error: WorkspaceGitError): string {
  if (error.code !== "identity_missing") return error.message;
  const reason = /[.!?]$/.test(error.message) ? error.message : `${error.message}.`;
  return `${reason} Set your name and email below, then finish again.`;
}

/**
 * Who last wrote each listed record, both copies. A record past the number one
 * read covers is in `unread`, so its item says the details are unavailable
 * rather than showing no authors; a read that fails does the same for all.
 */
async function fetchCommits(
  workspaceId: string,
  listed: readonly GitMergeConflict[],
): Promise<{
  readonly commits: ReadonlyMap<string, MergeRecordCommits>;
  readonly unread: ReadonlySet<string>;
  readonly failed: boolean;
}> {
  const { read, unread } = splitMergeCommitIds(
    listed.map((conflict) => conflict.recordId),
  );
  if (read.length === 0) return { commits: new Map(), unread, failed: false };
  try {
    const found = await git.mergeRecordCommits(workspaceId, read);
    return {
      commits: new Map(found.map((entry) => [entry.recordId, entry])),
      unread,
      failed: false,
    };
  } catch {
    return { commits: new Map(), unread, failed: true };
  }
}

/** Everything one read of the merge brings: its full conflict list, the decisions, what merged by itself. */
interface MergeRead {
  readonly conflicts: readonly GitMergeConflict[];
  readonly picks: ReadonlyMap<string, GitMergePick>;
  readonly notes: readonly GitMergeNote[];
  readonly commits: ReadonlyMap<string, MergeRecordCommits>;
  readonly commitsUnread: ReadonlySet<string>;
  readonly commitDetailsFailed: boolean;
}

/** Read the merge with `picks` deciding what the notes describe (the stored set when none are given). */
async function readMerge(
  workspaceId: string,
  picks?: readonly GitMergePick[],
): Promise<MergeRead> {
  const state = await git.mergeState(workspaceId, picks);
  const commits = await fetchCommits(workspaceId, state.conflicts);
  return {
    conflicts: state.conflicts,
    picks: picksFromList(state.picks),
    notes: state.notes,
    commits: commits.commits,
    commitsUnread: commits.unread,
    commitDetailsFailed: commits.failed,
  };
}

const itemKeyOf = (group: MergeConflictGroup): string => pickKey(group.recordId, "");
const firstConflictKey = (group: MergeConflictGroup): string =>
  pickKey(group.recordId, group.conflicts[0]?.path ?? "");

/** The group to open first: the first with something left to decide, else the first. */
function firstGroupOf(
  groups: readonly MergeConflictGroup[],
  picks: ReadonlyMap<string, GitMergePick>,
): MergeConflictGroup | undefined {
  return (
    groups.find((group) =>
      group.conflicts.some((conflict) => resolutionOf(picks, conflict) === undefined),
    ) ?? groups[0]
  );
}

/** How many conflicts of `group` are settled by a value the user typed. */
function typedValuesIn(
  group: MergeConflictGroup,
  picks: ReadonlyMap<string, GitMergePick>,
): number {
  return group.conflicts.filter((conflict) => {
    const resolution = resolutionOf(picks, conflict);
    return resolution !== undefined && "value" in resolution;
  }).length;
}

/**
 * The merge view: what this device and the remote disagree on, one conflicted
 * record or file at a time, with both copies and the result side by side.
 *
 * A full-window dialog rather than a page: the work ends in one commit or one
 * abandon, and it has to close back onto the workspace it started from. The
 * left list is the conflict inventory; the main pane is the selected item's
 * fields, each settled with an arrow from either copy or with a value of the
 * user's own. The conflict list is every conflict the merge has — computed
 * with no decisions — so a decision can be seen, changed, and counted; the
 * decisions are saved when the view closes, so nothing typed is lost.
 */
// fallow-ignore-next-line complexity -- the score is hook density: the conflicts, the picks, the notes, the authors, the selection and focus, busy, the error, the author form and three confirmations, plus the reads and the orchestration of save, finish and abandon. Every rule the decisions follow lives in utils/mergePicks and utils/mergeValues, and the list, pane, header and footer are their own components.
export function MergeView({ status, onClose, onStatus }: GitMergeViewProps) {
  const { workspaceId } = status;
  const [conflicts, setConflicts] = useState<readonly GitMergeConflict[] | null>(null);
  const [notes, setNotes] = useState<readonly GitMergeNote[]>([]);
  const [picks, setPicks] = useState<ReadonlyMap<string, GitMergePick>>(new Map());
  const [commits, setCommits] = useState<ReadonlyMap<string, MergeRecordCommits>>(new Map());
  const [commitsUnread, setCommitsUnread] = useState<ReadonlySet<string>>(new Set());
  const [commitDetailsFailed, setCommitDetailsFailed] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [invalidKeys, setInvalidKeys] = useState<ReadonlySet<string>>(new Set());
  const [authorNeeded, setAuthorNeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [confirmAll, setConfirmAll] = useState<GitMergeSide | null>(null);
  const [confirmItem, setConfirmItem] = useState<{
    readonly group: MergeConflictGroup;
    readonly side: GitMergeSide;
    readonly values: number;
  } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const groups = useMemo(() => groupConflicts(conflicts ?? []), [conflicts]);
  const selected = groups.find((group) => itemKeyOf(group) === selectedKey) ?? groups[0];
  const total = conflicts?.length ?? 0;
  const done = conflicts === null ? 0 : resolvedCount(conflicts, picks);
  const canFinish = conflicts !== null && allConflictsResolved(conflicts, picks);

  const apply = (read: MergeRead): void => {
    setConflicts(read.conflicts);
    setPicks(read.picks);
    setNotes(read.notes);
    setCommits(read.commits);
    setCommitsUnread(read.commitsUnread);
    setCommitDetailsFailed(read.commitDetailsFailed);
  };

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const read = await readMerge(workspaceId);
        if (!live) return;
        apply(read);
        const first = firstGroupOf(groupConflicts(read.conflicts), read.picks);
        setSelectedKey(first === undefined ? null : itemKeyOf(first));
      } catch (failure) {
        if (live) setError(errorText(failure));
      }
    })();
    return () => {
      live = false;
    };
  }, [workspaceId]);

  // The notes are what the merge repairs with the decisions made so far — a
  // pick can leave an edge or a frame dangling — so they follow the picks,
  // after the typing settles rather than on every keystroke.
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void git
        .mergeState(workspaceId, picksRequest(picks))
        .then((state) => {
          if (live) setNotes(state.notes);
        })
        .catch((failure: unknown) => {
          if (live) setError(errorText(failure));
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [workspaceId, picks]);

  useEffect(() => {
    if (focusKey === null) return;
    document.getElementById(`merge-row-${focusKey}`)?.focus();
    setFocusKey(null);
  }, [focusKey, selectedKey]);

  const select = (group: MergeConflictGroup): void => {
    setSelectedKey(itemKeyOf(group));
    const unresolved = group.conflicts.find(
      (conflict) => resolutionOf(picks, conflict) === undefined,
    );
    if (unresolved !== undefined) {
      const key = pickKey(unresolved.recordId, unresolved.path);
      setActiveKey(key);
      setFocusKey(key);
    }
  };

  const move = (direction: 1 | -1): void => {
    if (conflicts === null) return;
    const from = activeKey ?? (selected === undefined ? null : firstConflictKey(selected));
    const target = nextUnresolved(conflicts, picks, from, direction);
    if (target === undefined) return;
    const key = pickKey(target.recordId, target.path);
    setSelectedKey(pickKey(target.recordId, ""));
    setActiveKey(key);
    setFocusKey(key);
  };

  /** Store the decisions so closing loses nothing; throws to the caller when it cannot. */
  const save = (): Promise<unknown> => git.saveMergePicks(workspaceId, picksRequest(picks));

  const closeView = async (): Promise<void> => {
    setConfirmClose(false);
    setBusy(true);
    setError(null);
    try {
      await save();
      onClose();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const requestClose = (): void => {
    if (invalidKeys.size > 0) {
      setConfirmClose(true);
      return;
    }
    void closeView();
  };

  const finish = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setAuthorNeeded(false);
    try {
      await save();
      const next = await git.resolveMerge(workspaceId, picksRequest(picks));
      onStatus(next);
      if (next.state !== "merging") {
        onClose();
        return;
      }
      if (next.lastError !== null) {
        setError(mergeErrorText(next.lastError));
        setAuthorNeeded(next.lastError.code === "identity_missing");
      } else if (canFinish) {
        // Every conflict has a decision, yet the merge did not finish: the only
        // conflicts left are ones the decisions themselves made, which the
        // stable list cannot show — a value that no record may hold.
        setError(
          "A value you typed does not make a valid record, so the merge is still waiting. Keep one copy for the field it changed.",
        );
      }
      // The picks are stored; only what the merge now says needs rereading.
      const state = await git.mergeState(workspaceId);
      setConflicts(state.conflicts);
      setNotes(state.notes);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const finishWithAuthor = async (request: WorkspaceGitCommitRequest): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const named = await git.syncNow(workspaceId, request);
      onStatus(named);
      if (named.lastError !== null) {
        setError(named.lastError.message);
        return false;
      }
      setAuthorNeeded(false);
      await finish();
      return true;
    } catch (failure) {
      setError(errorText(failure));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const abandon = async (): Promise<void> => {
    setConfirmAbandon(false);
    setBusy(true);
    setError(null);
    try {
      onStatus(await git.abandonMerge(workspaceId));
      onClose();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const acceptItem = (group: MergeConflictGroup, side: GitMergeSide): void => {
    const values = typedValuesIn(group, picks);
    if (values > 0) {
      setConfirmItem({ group, side, values });
      return;
    }
    setPicks(withWholeRecordPick(picks, group.recordId, side));
  };

  const clearInvalid = (key: string, invalid: boolean): void => {
    setInvalidKeys((current) => {
      if (current.has(key) === invalid) return current;
      const next = new Set(current);
      if (invalid) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const clearPath = (path: string): void => {
    if (selected === undefined) return;
    const conflict = selected.conflicts.find((entry) => entry.path === path);
    if (conflict === undefined) return;
    setPicks(withoutResolvingPick(picks, conflict));
  };

  return (
    <>
      <Modal
        isOpen
        onClose={requestClose}
        title="Resolve merge"
        size="fullscreen"
        scrollable={false}
        footer={
          <MergeViewFooter
            busy={busy}
            resolved={done}
            total={total}
            canFinish={canFinish}
            onAbandon={() => setConfirmAbandon(true)}
            onPrevious={() => move(-1)}
            onNext={() => move(1)}
            onFinish={() => void finish()}
          />
        }
      >
        <div
          className="flex h-full min-h-0 flex-col"
          onKeyDown={(event) => {
            if (!event.altKey) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              move(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              move(-1);
            }
          }}
        >
          <MergeViewHeader
            status={status}
            resolved={done}
            total={total}
            notes={notes}
            error={error}
            disabled={busy}
            canAcceptAll={groups.length > 0}
            onAcceptAll={setConfirmAll}
          />
          {authorNeeded && (
            <div className="border-b border-border px-5 py-3 dark:border-border-dark">
              <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
                Git does not know who is making this merge&apos;s commit yet.
                Set your name and email, and Finish merge carries on.
              </p>
              <GitAuthorForm busy={busy} onCommit={finishWithAuthor} />
            </div>
          )}
          <MergeViewBody
            conflicts={conflicts}
            groups={groups}
            selected={selected}
            picks={picks}
            commits={commits}
            commitsUnread={commitsUnread}
            commitDetailsFailed={commitDetailsFailed}
            busy={busy}
            error={error}
            onSelect={select}
            onAcceptItem={(side) => selected !== undefined && acceptItem(selected, side)}
            field={{
              onSide: (path, side) =>
                selected !== undefined &&
                setPicks(withSidePick(picks, selected.recordId, path, side)),
              onValue: (path, value) =>
                selected !== undefined &&
                setPicks(withValuePick(picks, selected.recordId, path, value)),
              onClear: clearPath,
              onInvalidChange: (path, invalid) =>
                selected !== undefined &&
                clearInvalid(pickKey(selected.recordId, path), invalid),
              onFocus: (conflict) =>
                setActiveKey(pickKey(conflict.recordId, conflict.path)),
            }}
          />
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmAbandon}
        onClose={() => setConfirmAbandon(false)}
        onConfirm={() => void abandon()}
        title="Abandon this merge?"
        message="Every local commit and change stays on this device. Nothing is pushed. You can merge again with Sync now."
        confirmLabel="Abandon merge"
        intent="warning"
      />
      <ConfirmDialog
        open={confirmAll !== null}
        onClose={() => setConfirmAll(null)}
        onConfirm={() => {
          if (confirmAll !== null) {
            setPicks(acceptAllPicks(groups, picks, confirmAll));
            setConfirmAll(null);
          }
        }}
        title={`Accept all ${confirmAll === "ours" ? "your" : "remote"} copies?`}
        message="Every conflict in every record and file is settled by that copy. You can still change any field afterwards."
        confirmLabel="Accept all"
        intent="warning"
      />
      <ConfirmDialog
        open={confirmItem !== null}
        onClose={() => setConfirmItem(null)}
        onConfirm={() => {
          if (confirmItem !== null) {
            setPicks(withWholeRecordPick(picks, confirmItem.group.recordId, confirmItem.side));
            setConfirmItem(null);
          }
        }}
        title="Replace the values you typed?"
        message={`${confirmItem?.values ?? 0} ${confirmItem?.values === 1 ? "conflict is" : "conflicts are"} settled by a value you typed in ${confirmItem?.group.name ?? "this item"}. Accepting one copy replaces ${confirmItem?.values === 1 ? "it" : "them"}.`}
        confirmLabel="Replace them"
        intent="warning"
      />
      <ConfirmDialog
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={() => void closeView()}
        title="Close with a value that is not valid?"
        message="A value you typed is not valid JSON, so it settles nothing and will not be saved. Everything else you decided is saved."
        confirmLabel="Close"
        intent="warning"
      />
    </>
  );
}
