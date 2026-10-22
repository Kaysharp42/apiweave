import { Check } from "lucide-react";
import { humanizePath } from "@shared/conflict-diff";
import { Button } from "../atoms/Button";
import { GitMergeValue } from "./GitMergeValue";
import type { GitMergeFieldProps } from "../../types";

/**
 * One conflicted field: both copies side by side under their own words, and a
 * choice per copy. A conflict at `""` is the whole record or file, so its card's
 * whole-record buttons are its choice; an invalid record offers only those too.
 */
export function GitMergeField({
  conflict,
  recordName,
  selected,
  disabled,
  onPick,
}: GitMergeFieldProps) {
  const chooseHere = conflict.path !== "" && conflict.invalid === undefined;
  const heading =
    conflict.path !== ""
      ? humanizePath(conflict.path)
      : conflict.kind === "file"
        ? "Whole file"
        : "Whole record";
  const copies = [
    { side: "ours", owner: "Your", value: conflict.ours },
    { side: "theirs", owner: "Remote", value: conflict.theirs },
  ] as const;
  return (
    <li className="border-t border-border px-3 py-3 first:border-t-0 dark:border-border-dark">
      <p className="text-xs font-semibold text-text-primary dark:text-text-primary-dark">
        {heading}
      </p>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        {copies.map((copy) => (
          <div key={copy.side}>
            <p className="text-xxs font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark">
              {copy.owner} copy
            </p>
            <div className="mt-1">
              <GitMergeValue value={copy.value} />
            </div>
          </div>
        ))}
      </div>
      {chooseHere && (
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          {copies.map((copy) => (
            <Button
              key={copy.side}
              variant={selected === copy.side ? "secondary" : "outline"}
              intent={selected === copy.side ? "success" : "default"}
              size="sm"
              disabled={disabled}
              aria-pressed={selected === copy.side}
              aria-label={`Keep ${copy.owner.toLowerCase()} copy of ${humanizePath(conflict.path)} in ${recordName}`}
              icon={
                selected === copy.side ? (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                ) : undefined
              }
              onClick={() => onPick(copy.side)}
            >
              Keep {copy.owner.toLowerCase()} copy
            </Button>
          ))}
        </div>
      )}
    </li>
  );
}
