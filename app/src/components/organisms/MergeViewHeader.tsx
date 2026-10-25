import { Button } from "../atoms/Button";
import { MergeNotes } from "../molecules/MergeNotes";
import { remoteHost } from "../../utils/gitErrorMessages";
import type { MergeViewHeaderProps } from "../../types";

/**
 * The merge view's header: what the merge is between, how many conflicts are
 * settled, the explanation when the copies share no history, what merged by
 * itself, the bulk choices and the last failure.
 */
export function MergeViewHeader({
  status,
  resolved,
  total,
  notes,
  error,
  disabled,
  canAcceptAll,
  onAcceptAll,
}: MergeViewHeaderProps) {
  return (
    <header className="space-y-2 border-b border-border px-5 py-3 dark:border-border-dark">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
          This device <span aria-hidden="true">↔</span>{" "}
          {remoteHost(status.remoteUrl) ?? "the remote"}
          <span className="sr-only"> are being merged</span>
        </p>
        <p
          role="status"
          aria-live="polite"
          className="text-xs font-medium text-text-primary dark:text-text-primary-dark"
        >
          {resolved} of {total} conflicts resolved
        </p>
      </div>
      {status.unrelatedHistory && (
        <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
          This device and the remote have no history in common, so every
          difference is listed. Nothing is pushed until every conflict is
          settled.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="xs"
          disabled={disabled || !canAcceptAll}
          onClick={() => onAcceptAll("ours")}
        >
          Accept all yours
        </Button>
        <Button
          variant="outline"
          size="xs"
          disabled={disabled || !canAcceptAll}
          onClick={() => onAcceptAll("theirs")}
        >
          Accept all remote
        </Button>
      </div>
      <MergeNotes notes={notes} />
      {error !== null && (
        <p
          role="alert"
          className="break-words text-xs text-status-error dark:text-[var(--aw-status-error)]"
        >
          {error}
        </p>
      )}
    </header>
  );
}
