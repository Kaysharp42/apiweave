import { humanizePath } from "@shared/conflict-diff";
import { GitMergeValue } from "./GitMergeValue";
import { MergeResultCell } from "./MergeResultCell";
import { Button } from "../atoms/Button";
import { pickKey } from "../../utils/mergePicks";
import { resolvedValue } from "../../utils/mergeValues";
import type { MergeFieldRowProps } from "../../types";

/** The place in words: the path humanized, or what a conflict at the record's root is. */
function placeLabel(path: string, kind: MergeFieldRowProps["conflict"]["kind"]): string {
  if (path !== "") return humanizePath(path);
  return kind === "file" ? "Whole file" : "Whole record";
}

/**
 * One conflicted field, IntelliJ-style: your copy, the result, the remote's
 * copy, and an arrow from each side into the result. A field can be settled by
 * either copy or by a value of the user's own, typed into the result. A
 * conflict at the record's root (`""`) or over a whole invalid record is a
 * choice of copies only.
 */
export function MergeFieldRow({
  conflict,
  recordName,
  resolution,
  disabled,
  onFocus,
  onSide,
  onValue,
}: MergeFieldRowProps) {
  const heading = placeLabel(conflict.path, conflict.kind);
  const label = `${heading} in ${recordName}`;
  const current = resolvedValue(conflict, resolution);
  const sidesOnly = conflict.path === "" || conflict.invalid !== undefined;
  const side =
    resolution !== undefined && !("value" in resolution)
      ? resolution.side
      : undefined;

  return (
    <li
      id={`merge-row-${pickKey(conflict.recordId, conflict.path)}`}
      tabIndex={-1}
      onFocus={onFocus}
      aria-label={label}
      className="rounded-sm border border-border px-3 py-3 focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] dark:border-border-dark"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-text-primary dark:text-text-primary-dark">
          {heading}
        </p>
        {resolution === undefined && (
          <p className="text-xxs text-status-warning dark:text-[var(--aw-status-warning)]">
            Not settled
          </p>
        )}
      </div>
      {conflict.invalid !== undefined && (
        <p
          role="note"
          className="mt-1 text-xxs text-status-warning dark:text-[var(--aw-status-warning)]"
        >
          {conflict.invalid}. Keeping one whole copy is the way out.
        </p>
      )}
      <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_2rem_minmax(0,1.25fr)_2rem_minmax(0,1fr)] md:items-start">
        <section className="min-w-0">
          <p className="text-xxs font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark">
            Yours
          </p>
          <div className="mt-1">
            <GitMergeValue value={conflict.ours} />
          </div>
        </section>
        <div className="flex md:justify-center md:pt-6">
          <Button
            variant={side === "ours" ? "secondary" : "outline"}
            intent={side === "ours" ? "success" : "default"}
            size="xs"
            disabled={disabled}
            aria-pressed={side === "ours"}
            aria-label={`Take your copy of ${label}`}
            onClick={() => onSide("ours")}
          >
            <span aria-hidden="true">»</span>
          </Button>
        </div>
        <MergeResultCell
          conflict={conflict}
          label={label}
          current={current}
          resolution={resolution}
          sidesOnly={sidesOnly}
          disabled={disabled}
          onValue={onValue}
        />
        <div className="flex md:justify-center md:pt-6">
          <Button
            variant={side === "theirs" ? "secondary" : "outline"}
            intent={side === "theirs" ? "success" : "default"}
            size="xs"
            disabled={disabled}
            aria-pressed={side === "theirs"}
            aria-label={`Take the remote copy of ${label}`}
            onClick={() => onSide("theirs")}
          >
            <span aria-hidden="true">«</span>
          </Button>
        </div>
        <section className="min-w-0">
          <p className="text-xxs font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark">
            Theirs
          </p>
          <div className="mt-1">
            <GitMergeValue value={conflict.theirs} />
          </div>
        </section>
      </div>
    </li>
  );
}
