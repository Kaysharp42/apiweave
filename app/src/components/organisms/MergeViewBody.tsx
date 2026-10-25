import { MergeBodyNotice } from "../molecules/MergeBodyNotice";
import { MergeItemList } from "../molecules/MergeItemList";
import { MergeItemPane } from "./MergeItemPane";
import { pickKey } from "../../utils/mergePicks";
import type { MergeViewBodyProps } from "../../types";

const READING = "Reading the merge…";
const NO_CONFLICTS =
  "No conflicts are waiting. Finish merge commits the merge, or abandon it and keep this device's commits as they are.";

/** What to say instead of the panes, or null when they belong on screen. */
function bodyNotice(
  conflicts: MergeViewBodyProps["conflicts"],
  groups: MergeViewBodyProps["groups"],
  error: string | null,
): string | null {
  if (conflicts === null) return error === null ? READING : null;
  return groups.length === 0 ? NO_CONFLICTS : null;
}

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
  commitsUnread,
  commitDetailsFailed,
  busy,
  error,
  onSelect,
  onAcceptItem,
  field,
}: MergeViewBodyProps) {
  const notice = bodyNotice(conflicts, groups, error);
  if (notice !== null) return <MergeBodyNotice text={notice} />;
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
          commitDetailsUnavailable={
            commitDetailsFailed || commitsUnread.has(selected.recordId)
          }
          disabled={busy}
          onAcceptItem={onAcceptItem}
          onSide={field.onSide}
          onValue={field.onValue}
          onClear={field.onClear}
          onInvalidChange={field.onInvalidChange}
          onFocus={field.onFocus}
        />
      )}
    </div>
  );
}
