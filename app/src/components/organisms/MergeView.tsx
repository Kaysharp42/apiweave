import { useEffect, useMemo, useState } from "react";
import type { GitMergeConflict } from "@shared/types/GitMergeConflict";
import type { GitMergeNote } from "@shared/types/GitMergeNote";
import type { GitMergePick } from "@shared/types/GitMergePick";
import type { GitMergeSide } from "@shared/types/GitMergeSide";
import type { MergeRecordCommits } from "@shared/types/MergeRecordCommits";
import type { WorkspaceGitError } from "@shared/types/WorkspaceGitError";
import { ConfirmDialog } from "../molecules/ConfirmDialog";
import { Modal } from "../molecules/Modal";
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
} from "../../utils/mergePicks";
import type { GitMergeViewProps, MergeConflictGroup } from "../../types";

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Why a resolve left the merge waiting, in the user's terms; a missing author says where to set one. */
function mergeErrorText(error: WorkspaceGitError): string {
  if (error.code !== "identity_missing") return error.message;
  const reason = /[.!?]$/.test(error.message) ? error.message : `${error.message}.`;
  return `${reason} Set your name and email in Version history settings.`;
}

/** Who last wrote each listed record, both copies; null when the details cannot be read. */
async function fetchCommits(
  workspaceId: string,
  listed: readonly GitMergeConflict[],
): Promise<ReadonlyMap<string, MergeRecordCommits> | null> {
  const recordIds = [...new Set(listed.map((conflict) => conflict.recordId))];
  if (recordIds.length === 0) return new Map();
  try {
    const found = await git.mergeRecordCommits(workspaceId, recordIds.slice(0, 500));
    return new Map(found.map((entry) => [entry.recordId, entry]));
  } catch {
    return null;
  }
}

/** One read of everything the view shows: the conflicts, the decisions so far, what merged by itself, and the authors. */
interface MergeRead {
  readonly conflicts: readonly GitMergeConflict[];
  readonly picks: ReadonlyMap<string, GitMergePick>;
  readonly notes: readonly GitMergeNote[];
  readonly commits: ReadonlyMap<string, MergeRecordCommits>;
  readonly commitDetailsFailed: boolean;
}

async function readMerge(workspaceId: string): Promise<MergeRead> {
  const conflicts = await git.mergeConflicts(workspaceId);
  const picks = picksFromList(await git.mergePicks(workspaceId));
  const notes = await git.mergeNotes(workspaceId);
  const commits = await fetchCommits(workspaceId, conflicts);
  return {
    conflicts,
    picks,
    notes,
    commits: commits ?? new Map(),
    commitDetailsFailed: commits === null,
  };
}

/** The item key (`recordId` + `""`), and the conflict key of a group's first conflict. */
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

/**
 * The merge view: what this device and the remote disagree on, one conflicted
 * record or file at a time, with both copies and the result side by side.
 *
 * A full-window dialog rather than a page: the work ends in one commit or one
 * abandon, and it has to close back onto the workspace it started from. The
 * left list is the conflict inventory; the main pane is the selected item's
 * fields, each settled with an arrow from either copy or with a value of the
 * user's own. Every decision is sent as the complete set, so a resolve that
 * leaves conflicts waiting loses nothing, and a picker reopened starts where it
 * left off.
 */
// fallow-ignore-next-line complexity -- the score is hook density: twelve pieces of state (the conflicts, the picks, what merged by itself, the authors, the selection and focus, busy, the error and the two confirmations), two reads, and the orchestration of finish and abandon. Every rule the decisions follow lives in utils/mergePicks and utils/mergeValues, and the list, pane, header and footer are their own components.
export function MergeView({ status, onClose, onStatus }: GitMergeViewProps) {
  const { workspaceId } = status;
  const [conflicts, setConflicts] = useState<readonly GitMergeConflict[] | null>(null);
  const [notes, setNotes] = useState<readonly GitMergeNote[]>([]);
  const [picks, setPicks] = useState<ReadonlyMap<string, GitMergePick>>(new Map());
  const [commits, setCommits] = useState<ReadonlyMap<string, MergeRecordCommits>>(new Map());
  const [commitDetailsFailed, setCommitDetailsFailed] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [confirmAll, setConfirmAll] = useState<GitMergeSide | null>(null);

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

  const finish = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await git.resolveMerge(workspaceId, picksRequest(picks));
      onStatus(next);
      if (next.state !== "merging") {
        onClose();
        return;
      }
      if (next.lastError !== null) setError(mergeErrorText(next.lastError));
      const read = await readMerge(workspaceId);
      apply(read);
      const nextGroups = groupConflicts(read.conflicts);
      if (!nextGroups.some((group) => itemKeyOf(group) === selectedKey)) {
        const first = firstGroupOf(nextGroups, read.picks);
        setSelectedKey(first === undefined ? null : itemKeyOf(first));
      }
    } catch (failure) {
      setError(errorText(failure));
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

  return (
    <>
      <Modal
        isOpen
        onClose={onClose}
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
          <MergeViewBody
            conflicts={conflicts}
            groups={groups}
            selected={selected}
            picks={picks}
            commits={commits}
            commitDetailsFailed={commitDetailsFailed}
            busy={busy}
            error={error}
            onSelect={select}
            onAcceptItem={(side) =>
              selected !== undefined &&
              setPicks(withWholeRecordPick(picks, selected.recordId, side))
            }
            onSide={(path, side) =>
              selected !== undefined &&
              setPicks(withSidePick(picks, selected.recordId, path, side))
            }
            onValue={(path, value) =>
              selected !== undefined &&
              setPicks(withValuePick(picks, selected.recordId, path, value))
            }
            onFocus={(conflict) =>
              setActiveKey(pickKey(conflict.recordId, conflict.path))
            }
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
            setPicks(acceptAllPicks(groups, confirmAll));
            setConfirmAll(null);
          }
        }}
        title={`Accept all ${confirmAll === "ours" ? "your" : "the remote"} copies?`}
        message="Every conflict in every record and file is settled by that copy. You can still change any field afterwards."
        confirmLabel="Accept all"
        intent="warning"
      />
    </>
  );
}
