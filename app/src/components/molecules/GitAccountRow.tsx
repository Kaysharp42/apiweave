import { Badge } from "../atoms/Badge";
import { GIT_PROVIDERS, gitAccountInitials } from "../../utils/gitAccounts";
import type { GitAccountRowProps } from "../../types";

/**
 * One `gh`/`glab` account: its initials, login and host, how its tool reaches
 * repositories, and anything wrong with its sign-in. An account a workspace
 * uses that no tool lists any more reads as not signed in rather than
 * vanishing, so the binding is never silently lost from view.
 */
export function GitAccountRow({ account, current = false, detail }: GitAccountRowProps) {
  const listed = "problem" in account ? account : null;
  const tool = GIT_PROVIDERS[account.provider].command;
  const facts = [
    account.host,
    listed === null ? null : listed.gitProtocol === "ssh" ? "SSH" : "HTTPS",
    // glab keeps one account per host, so only gh has an active account worth naming.
    listed?.active === true && account.provider === "github" ? `${tool}'s active account` : null,
  ].filter((fact): fact is string => fact !== null);
  const problem = listed === null ? `${tool} is not signed in as ${account.login} any more` : listed.problem;

  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary dark:bg-primary-light/10 dark:text-primary-light"
      >
        {gitAccountInitials(account.login)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium text-text-primary dark:text-text-primary-dark">
            {account.login}
          </span>
          {current && (
            <Badge variant="primary" size="xs">
              This workspace
            </Badge>
          )}
        </div>
        <p className="text-xs text-text-secondary dark:text-text-secondary-dark">{facts.join(" · ")}</p>
        {problem !== null && <p className="text-xs text-status-warning">{problem}</p>}
        {detail}
      </div>
    </div>
  );
}
