import { NOT_PRESENT } from "../../utils/mergeCommits";
import type { GitMergeValueProps } from "../../types";

/**
 * One side's value at a conflicted field: text as text, anything structured as
 * compact JSON in a bounded pane, and a value this side does not hold — it
 * deleted it, or never added it — as the plain words for that.
 */
export function GitMergeValue({ value }: GitMergeValueProps) {
  if (value === undefined) {
    return (
      <p className="text-xs italic text-text-muted dark:text-text-muted-dark">
        {NOT_PRESENT}
      </p>
    );
  }
  if (typeof value === "string") {
    return (
      <p className="whitespace-pre-wrap break-words text-sm text-text-primary dark:text-text-primary-dark">
        {value === "" ? '""' : value}
      </p>
    );
  }
  return (
    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-surface-overlay p-2 font-mono text-xxs text-text-primary dark:bg-surface-dark-overlay dark:text-text-primary-dark">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
