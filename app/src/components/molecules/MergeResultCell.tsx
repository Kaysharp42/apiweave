import { GitMergeValue } from "./GitMergeValue";
import { MergeResultEditor } from "./MergeResultEditor";
import { fieldEditorKind } from "../../utils/mergeValues";
import type { MergeResultCellProps } from "../../types";

/**
 * The Result column: what the merge would write now, and the way to edit it. A
 * whole-record or whole-file conflict, or one over an invalid record, is a
 * choice of copies only.
 */
export function MergeResultCell({
  conflict,
  label,
  current,
  resolution,
  sidesOnly,
  disabled,
  onValue,
  onClear,
  onInvalidChange,
}: MergeResultCellProps) {
  const kind = fieldEditorKind(conflict, current);
  return (
    <section className="min-w-0">
      <p className="text-xxs font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark">
        Result
      </p>
      <div className="mt-1">
        {sidesOnly ? (
          resolution === undefined && current === undefined ? (
            <p className="text-xs italic text-text-muted dark:text-text-muted-dark">
              Unresolved. The remote copy stands in until you choose one.
            </p>
          ) : (
            <GitMergeValue value={current} />
          )
        ) : (
          <MergeResultEditor
            label={label}
            value={current}
            text={kind.text}
            long={kind.long}
            resolved={resolution !== undefined}
            disabled={disabled}
            onChange={onValue}
            onClear={onClear}
            onInvalidChange={onInvalidChange}
          />
        )}
      </div>
    </section>
  );
}
