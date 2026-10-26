import { GitMergeValue } from "./GitMergeValue";
import { Button } from "../atoms/Button";
import type { MergeChoiceProps, MergeSideColumnProps } from "../../types";

/**
 * One side's choice for one field, as an arrow between the columns or a
 * labelled button under the copy. Both carry the same accessible name, so a
 * test or a reader finds the same control at either width.
 */
export function MergeChoice({
  side,
  label,
  chosen,
  disabled,
  onChoose,
}: MergeChoiceProps) {
  return (
    <Button
      variant={chosen ? "secondary" : "outline"}
      intent={chosen ? "success" : "default"}
      size="xs"
      disabled={disabled}
      aria-pressed={chosen}
      aria-label={`Take ${side === "ours" ? "your" : "the remote"} copy of ${label}`}
      onClick={onChoose}
    >
      {side === "ours" ? "Use yours" : "Use remote"}
    </Button>
  );
}

/** One copy's column: its heading, its value, and — when the columns are stacked — its labelled choice. */
export function MergeSideColumn({
  side,
  label,
  value,
  chosen,
  wide,
  disabled,
  onChoose,
}: MergeSideColumnProps) {
  return (
    <section className="min-w-0">
      <p className="text-xxs font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark">
        {side === "ours" ? "Yours" : "Remote"}
      </p>
      <div className="mt-1">
        <GitMergeValue value={value} />
      </div>
      {!wide && (
        <div className="mt-2">
          <MergeChoice
            side={side}
            label={label}
            chosen={chosen}
            disabled={disabled}
            onChoose={onChoose}
          />
        </div>
      )}
    </section>
  );
}

/** The arrow a side takes into the result when the columns sit side by side. */
export function MergeArrow({
  side,
  label,
  chosen,
  disabled,
  onChoose,
}: MergeChoiceProps) {
  return (
    <Button
      variant={chosen ? "secondary" : "outline"}
      intent={chosen ? "success" : "default"}
      size="xs"
      disabled={disabled}
      aria-pressed={chosen}
      aria-label={`Take ${side === "ours" ? "your" : "the remote"} copy of ${label}`}
      onClick={onChoose}
    >
      <span aria-hidden="true">{side === "ours" ? "»" : "«"}</span>
    </Button>
  );
}
