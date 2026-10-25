import { useState } from "react";
import { GitMergeValue } from "./GitMergeValue";
import { MergeCompare } from "./MergeCompare";
import { MergeResultEditor } from "./MergeResultEditor";
import { Button } from "../atoms/Button";
import { isLongValue } from "../../utils/mergeValues";
import type { MergeResultCellProps } from "../../types";

/**
 * The Result column: what the merge would write now, and the way to edit it.
 * A whole-record or whole-file conflict, or one over an invalid record, is a
 * choice of copies only. A long value can be compared in a diff first.
 */
export function MergeResultCell({
  conflict,
  label,
  current,
  resolution,
  sidesOnly,
  disabled,
  onValue,
}: MergeResultCellProps) {
  const [comparing, setComparing] = useState(false);
  const long =
    !sidesOnly &&
    (isLongValue(conflict.ours) ||
      isLongValue(conflict.theirs) ||
      isLongValue(current));
  return (
    <section className="min-w-0">
      <p className="text-xxs font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark">
        Result
      </p>
      <div className="mt-1">
        {sidesOnly ? (
          resolution === undefined && current === undefined ? (
            <p className="text-xs italic text-text-muted dark:text-text-muted-dark">
              Not settled. The remote copy stands in until you choose one.
            </p>
          ) : (
            <GitMergeValue value={current} />
          )
        ) : (
          <MergeResultEditor
            label={label}
            value={current}
            resolved={resolution !== undefined}
            disabled={disabled}
            onChange={onValue}
          />
        )}
      </div>
      {long && (
        <div className="mt-2 space-y-2">
          <Button
            variant="ghost"
            size="xs"
            disabled={disabled}
            aria-expanded={comparing}
            onClick={() => setComparing(!comparing)}
          >
            {comparing ? "Hide comparison" : "Compare"}
          </Button>
          {comparing && (
            <MergeCompare label={label} ours={conflict.ours} theirs={conflict.theirs} />
          )}
        </div>
      )}
    </section>
  );
}
