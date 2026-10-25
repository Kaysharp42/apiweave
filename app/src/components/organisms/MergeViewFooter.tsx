import { Button } from "../atoms/Button";
import { Tooltip } from "../atoms/Tooltip";
import type { MergeViewFooterProps } from "../../types";

/** The merge view's actions: give up, move between what is left, or finish. */
export function MergeViewFooter({
  busy,
  resolved,
  total,
  canFinish,
  onAbandon,
  onPrevious,
  onNext,
  onFinish,
}: MergeViewFooterProps) {
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <Button
        variant="outline"
        intent="error"
        size="sm"
        disabled={busy}
        onClick={onAbandon}
      >
        Abandon merge
      </Button>
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip content="Previous unresolved conflict (Alt+↑)">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || resolved === total}
            onClick={onPrevious}
          >
            Previous conflict
          </Button>
        </Tooltip>
        <Tooltip content="Next unresolved conflict (Alt+↓)">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || resolved === total}
            onClick={onNext}
          >
            Next conflict
          </Button>
        </Tooltip>
        <Button
          variant="primary"
          size="sm"
          disabled={busy || !canFinish}
          loading={busy}
          onClick={onFinish}
        >
          Finish merge
        </Button>
      </div>
    </div>
  );
}
