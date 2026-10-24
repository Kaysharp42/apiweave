import { Spinner } from "../atoms/Spinner";
import type { GitAccountsNoticeProps } from "../../types";

/**
 * Where a list of `gh`/`glab` accounts stands, said rather than left as an
 * empty list: still being asked, none signed in, or what went wrong asking.
 * A live region, so the change from asking to answered is announced.
 */
export function GitAccountsNotice({ loaded, empty, emptyText, problems }: GitAccountsNoticeProps) {
  return (
    <div aria-live="polite" className="space-y-1">
      {!loaded && (
        <div className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
          <Spinner size="sm" />
          Asking gh and glab…
        </div>
      )}
      {loaded && empty && emptyText !== null && <p className="text-sm text-text-secondary dark:text-text-secondary-dark">{emptyText}</p>}
      {problems.map((problem) => (
        <p key={problem} className="text-xs text-status-warning">
          {problem}
        </p>
      ))}
    </div>
  );
}
