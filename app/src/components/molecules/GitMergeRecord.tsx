import { Check } from "lucide-react";
import type { GitMergeConflict } from "@shared/types/GitMergeConflict";
import type { MergeSideCommit } from "@shared/types/MergeSideCommit";
import { Badge } from "../atoms/Badge";
import { Button } from "../atoms/Button";
import { GitMergeField } from "./GitMergeField";
import { describeMergeCommit, mergeCommitSubject } from "../../utils/mergeCommits";
import { pickKey, sideOfConflict } from "../../utils/mergePicks";
import type { GitMergeRecordProps, GitMergeWholeButtonProps } from "../../types";

const KIND_LABELS: Readonly<Record<GitMergeConflict["kind"], string>> = {
  workspace: "Workspace",
  project: "Project",
  workflow: "Workflow",
  environment: "Environment",
  file: "File",
};

/** "Your copy · Ada Lovelace · 3f9a2c1 · 2026-10-20", and the commit's subject under it. */
function commitLine(
  heading: string,
  commit: MergeSideCommit | null | undefined,
) {
  const subject = mergeCommitSubject(commit ?? null);
  return (
    <div className="min-w-0">
      <p className="truncate text-xxs text-text-muted dark:text-text-muted-dark">
        {heading} · {describeMergeCommit(commit ?? null)}
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

/**
 * One conflicted record or file: what it is, who last wrote each copy, the
 * choice for the whole record, and a row per conflicted field. A record whose
 * two changes make no valid record together says why and offers only the
 * whole-record choice.
 */
export function GitMergeRecord({
  group,
  picks,
  commits,
  commitDetailsFailed,
  disabled,
  onWholeRecord,
  onPath,
}: GitMergeRecordProps) {
  const whole = picks.get(pickKey(group.recordId, ""));
  const invalid = group.conflicts.find(
    (conflict) => conflict.invalid !== undefined,
  )?.invalid;
  return (
    <li className="rounded-sm border border-border bg-surface-raised dark:border-border-dark dark:bg-surface-dark-raised">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border bg-surface-overlay/60 px-3 py-2 dark:border-border-dark dark:bg-surface-dark-overlay/60">
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
          {commitDetailsFailed ? (
            <p className="text-xxs italic text-text-muted dark:text-text-muted-dark">
              Commit details unavailable
            </p>
          ) : (
            commits !== undefined && (
              <div className="grid gap-1 md:grid-cols-2">
                {commitLine("Your copy", commits.ours)}
                {commitLine("Remote copy", commits.theirs)}
              </div>
            )
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WholeRecordButton
            label="Keep your copy for all conflicts"
            name={group.name}
            side="ours"
            chosen={whole}
            disabled={disabled}
            onChoose={onWholeRecord}
          />
          <WholeRecordButton
            label="Keep remote copy for all conflicts"
            name={group.name}
            side="theirs"
            chosen={whole}
            disabled={disabled}
            onChoose={onWholeRecord}
          />
        </div>
      </div>
      {invalid !== undefined && (
        <p
          role="note"
          className="border-b border-border px-3 py-2 text-xs text-status-warning dark:border-border-dark dark:text-[var(--aw-status-warning)]"
        >
          {invalid}. Keeping one whole copy is the way out.
        </p>
      )}
      <ul aria-label={`Conflicts in ${group.name}`}>
        {group.conflicts.map((conflict) => (
          <GitMergeField
            key={pickKey(conflict.recordId, conflict.path)}
            conflict={conflict}
            recordName={group.name}
            selected={sideOfConflict(picks, conflict)}
            disabled={disabled}
            onPick={(side) => onPath(conflict.path, side)}
          />
        ))}
      </ul>
    </li>
  );
}

function WholeRecordButton({
  label,
  name,
  side,
  chosen,
  disabled,
  onChoose,
}: GitMergeWholeButtonProps) {
  const selected = chosen === side;
  return (
    <Button
      variant={selected ? "secondary" : "outline"}
      intent={selected ? "success" : "default"}
      size="sm"
      disabled={disabled}
      aria-label={`${label} in ${name}`}
      aria-pressed={selected}
      icon={
        selected ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : undefined
      }
      onClick={() => onChoose(side)}
    >
      {label}
    </Button>
  );
}
