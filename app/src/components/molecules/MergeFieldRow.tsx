import { humanizePath } from "@shared/conflict-diff";
import { MergeArrow, MergeSideColumn } from "./MergeSideColumn";
import { MergeCompareToggle } from "./MergeCompareToggle";
import { MergeFieldHeader } from "./MergeFieldHeader";
import { MergeResultCell } from "./MergeResultCell";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { pickKey } from "../../utils/mergePicks";
import {
  fieldEditorKind,
  isLongValue,
  resolvedValue,
} from "../../utils/mergeValues";
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
 *
 * From `xl` the five columns sit side by side with the arrows between them;
 * below it the copies and the result stack, and the same choice is offered as
 * two labelled buttons.
 */
export function MergeFieldRow({
  conflict,
  recordName,
  resolution,
  disabled,
  onFocus,
  onSide,
  onValue,
  onClear,
  onInvalidChange,
}: MergeFieldRowProps) {
  const wide = useMediaQuery("(min-width: 1280px)");
  const heading = placeLabel(conflict.path, conflict.kind);
  const label = `${heading} in ${recordName}`;
  const current = resolvedValue(conflict, resolution);
  const sidesOnly = conflict.path === "" || conflict.invalid !== undefined;
  const long =
    !sidesOnly &&
    (fieldEditorKind(conflict, current).long ||
      isLongValue(conflict.ours) ||
      isLongValue(conflict.theirs));
  const side =
    resolution !== undefined && !("value" in resolution)
      ? resolution.side
      : undefined;
  const chosen = (which: "ours" | "theirs"): boolean => side === which;

  return (
    <li
      id={`merge-row-${pickKey(conflict.recordId, conflict.path)}`}
      tabIndex={-1}
      onFocus={onFocus}
      aria-label={label}
      className="rounded-sm border border-border px-3 py-3 focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] dark:border-border-dark"
    >
      <MergeFieldHeader
        heading={heading}
        resolved={resolution !== undefined}
        invalid={conflict.invalid}
      />
      <div className="mt-2 grid gap-2 xl:grid-cols-[minmax(0,1fr)_2rem_minmax(0,1.25fr)_2rem_minmax(0,1fr)] xl:items-start">
        <MergeSideColumn
          side="ours"
          label={label}
          value={conflict.ours}
          chosen={chosen("ours")}
          wide={wide}
          disabled={disabled}
          onChoose={() => onSide("ours")}
        />
        <div className="hidden xl:flex xl:justify-center xl:pt-6">
          {wide && (
            <MergeArrow
              side="ours"
              label={label}
              chosen={chosen("ours")}
              disabled={disabled}
              onChoose={() => onSide("ours")}
            />
          )}
        </div>
        <MergeResultCell
          conflict={conflict}
          label={label}
          current={current}
          resolution={resolution}
          sidesOnly={sidesOnly}
          disabled={disabled}
          onValue={onValue}
          onClear={onClear}
          onInvalidChange={onInvalidChange}
        />
        <div className="hidden xl:flex xl:justify-center xl:pt-6">
          {wide && (
            <MergeArrow
              side="theirs"
              label={label}
              chosen={chosen("theirs")}
              disabled={disabled}
              onChoose={() => onSide("theirs")}
            />
          )}
        </div>
        <MergeSideColumn
          side="theirs"
          label={label}
          value={conflict.theirs}
          chosen={chosen("theirs")}
          wide={wide}
          disabled={disabled}
          onChoose={() => onSide("theirs")}
        />
        {long && (
          <MergeCompareToggle
            label={label}
            ours={conflict.ours}
            theirs={conflict.theirs}
            disabled={disabled}
          />
        )}
      </div>
    </li>
  );
}
