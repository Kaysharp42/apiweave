import { MergeItemList } from "../molecules/MergeItemList";
import { MergeItemPane } from "./MergeItemPane";
import { pickKey } from "../../utils/mergePicks";
import type { MergeViewBodyProps } from "../../types";

const NO_CONFLICTS =
  "No conflicts are waiting. Finish merge commits the merge, or abandon it and keep this device's commits as they are.";

/**
 * The two panes: the conflict inventory on the left, the selected item's
 * fields on the right — or what to read instead while the merge loads, and
 * when it turns out to have nothing left to ask.
 */
export function MergeViewBody({
  conflicts,
  groups,
  selected,
  picks,
  commits,
  commitDetailsFailed,
  busy,
  error,
  onSelect,
  onAcceptItem,
  onSide,
  onValue,
  onFocus,
}: MergeViewBodyProps) {
  if (conflicts === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-text-secondary dark:text-text-secondary-dark">
        {error === null ? "Reading the merge…" : null}
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-5 text-sm text-text-secondary dark:text-text-secondary-dark">
        {NO_CONFLICTS}
      </div>
    );
  }
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[17rem_minmax(0,1fr)]">
      <MergeItemList
        groups={groups}
        picks={picks}
        selectedKey={selected === undefined ? null : pickKey(selected.recordId, "")}
        disabled={busy}
        onSelect={onSelect}
      />
      {selected !== undefined && (
        <MergeItemPane
          group={selected}
          picks={picks}
          commits={commits.get(selected.recordId)}
          commitDetailsFailed={commitDetailsFailed}
          disabled={busy}
          onAcceptItem={onAcceptItem}
          onSide={onSide}
          onValue={onValue}
          onFocus={onFocus}
        />
      )}
    </div>
  );
}
