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
      <p className="text-xs italic text-text-secondary dark:text-text-secondary-dark">
        {NOT_PRESENT}
      </p>
    );
  }
  if (typeof value === "string") {
    return (
      <p className="whitespace-pre-wrap wrap-break-word text-sm text-text-primary dark:text-text-primary-dark">
        {value === "" ? '""' : value}
      </p>
    );
  }
  return (
    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xs bg-surface-overlay p-2 font-mono text-2xs text-text-primary dark:bg-surface-dark-overlay dark:text-text-primary-dark">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
