import { LocateFixed } from "lucide-react";
import type { RunFollowPillProps } from "../../types";

/**
 * Shown while a run is still going but the user has moved the camera themselves.
 *
 * It exists because suspending on the first touch is only half of the contract:
 * taking the camera back has to be one click, or the choice to look at something
 * mid-run costs you the rest of the run. Deliberately an offer and not a
 * notification — nothing re-engages following except pressing this.
 */
export function RunFollowPill({ onResume }: RunFollowPillProps) {
  return (
    <button
      type="button"
      onClick={onResume}
      title="Follow the running workflow again"
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-sm font-medium bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border border-border dark:border-border-dark shadow-node hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors motion-reduce:transition-none"
    >
      <LocateFixed className="w-4 h-4 flex-shrink-0 text-primary" />
      Resume follow
    </button>
  );
}
