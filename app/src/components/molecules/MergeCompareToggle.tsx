import { useState } from "react";
import { Button } from "../atoms/Button";
import { MergeCompare } from "./MergeCompare";
import type { MergeCompareToggleProps } from "../../types";

/** Shows a read-only diff of both copies of a long value, folded until asked. */
export function MergeCompareToggle({ label, ours, theirs, disabled }: MergeCompareToggleProps) {
  const [comparing, setComparing] = useState(false);
  return (
    <div className="space-y-2 xl:col-span-full">
      <Button
        variant="ghost"
        size="xs"
        disabled={disabled}
        aria-expanded={comparing}
        onClick={() => setComparing(!comparing)}
      >
        {comparing ? "Hide comparison" : "Compare"}
      </Button>
      {comparing && <MergeCompare label={label} ours={ours} theirs={theirs} />}
    </div>
  );
}
