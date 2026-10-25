import type { GitMergeConflict } from "@shared/types/GitMergeConflict";
import type { MergeRecordCommits } from "@shared/types/MergeRecordCommits";
import { Badge } from "../atoms/Badge";
import { Button } from "../atoms/Button";
import { MergeFieldRow } from "../molecules/MergeFieldRow";
import { describeMergeCommit, mergeCommitSubject } from "../../utils/mergeCommits";
import { pickKey, resolutionOf } from "../../utils/mergePicks";
import type { MergeItemPaneProps } from "../../types";

const KIND_LABELS: Readonly<Record<GitMergeConflict["kind"], string>> = {
  workspace: "Workspace",
  project: "Project",
  workflow: "Workflow",
  environment: "Environment",
  file: "File",
};

/**
 * The selected record or file: what it is, who last wrote each copy, the
 * choice for the whole item, and a row per conflicted field.
 */
export function MergeItemPane({
  group,
  picks,
  commits,
  commitDetailsFailed,
  disabled,
  onAcceptItem,
  onSide,
  onValue,
  onFocus,
}: MergeItemPaneProps) {
  return (
    <section
      className="min-h-0 overflow-y-auto px-4 py-3"
      aria-label={`Conflicts in ${group.name}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" size="sm">
              {KIND_LABELS[group.kind]}
            </Badge>
            {group.kind === "file" ? (
              <code className="min-w-0 break-all text-xs text-text-primary dark:text-text-primary-dark">
                {group.name}
              </code>
            ) : (
              <span className="text-sm font-semibold text-text-primary dark:text-text-primary-dark">
                {group.name}
              </span>
            )}
          </div>
          <CommitLines commits={commits} detailsFailed={commitDetailsFailed} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["ours", "theirs"] as const).map((side) => (
            <Button
              key={side}
              variant="outline"
              size="xs"
              disabled={disabled}
              aria-label={`Accept all ${side === "ours" ? "your" : "the remote"} copies in ${group.name}`}
              onClick={() => onAcceptItem(side)}
            >
              Accept {side === "ours" ? "yours" : "theirs"}
            </Button>
          ))}
        </div>
      </div>
      <ul className="mt-3 space-y-3">
        {group.conflicts.map((conflict) => (
          <MergeFieldRow
            key={pickKey(conflict.recordId, conflict.path)}
            conflict={conflict}
            recordName={group.name}
            resolution={resolutionOf(picks, conflict)}
            disabled={disabled}
            onFocus={() => onFocus(conflict)}
            onSide={(side) => onSide(conflict.path, side)}
            onValue={(value) => onValue(conflict.path, value)}
          />
        ))}
      </ul>
    </section>
  );
}

/** The two sides' last commits for the selected item, or why they are not shown. */
function CommitLines({
  commits,
  detailsFailed,
}: {
  readonly commits: MergeRecordCommits | undefined;
  readonly detailsFailed: boolean;
}) {
  if (detailsFailed) {
    return (
      <p className="text-xxs italic text-text-muted dark:text-text-muted-dark">
        Commit details unavailable
      </p>
    );
  }
  if (commits === undefined) return null;
  return (
    <div className="grid gap-1 md:grid-cols-2">
      <CommitLine heading="Your copy" commit={commits.ours} />
      <CommitLine heading="Remote copy" commit={commits.theirs} />
    </div>
  );
}

/** "Your copy · Ada Lovelace · 3f9a2c1 · 2026-10-20", and the commit's subject under it. */
function CommitLine({
  heading,
  commit,
}: {
  readonly heading: string;
  readonly commit: MergeRecordCommits["ours"];
}) {
  const subject = mergeCommitSubject(commit);
  return (
    <div className="min-w-0">
      <p className="truncate text-xxs text-text-muted dark:text-text-muted-dark">
        {heading} · {describeMergeCommit(commit)}
      </p>
      {subject !== null && (
        <p
          className="truncate text-xxs text-text-secondary dark:text-text-secondary-dark"
          title={subject}
        >
          {subject}
        </p>
      )}
    </div>
  );
}
