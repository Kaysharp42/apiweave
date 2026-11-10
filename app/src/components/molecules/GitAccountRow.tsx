import { Badge } from "../atoms/Badge";
import { GIT_PROVIDERS } from "../../utils/gitAccounts";
import { GitAvatar } from "./GitAvatar";
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
      <GitAvatar account={account} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="min-w-0 max-w-full truncate text-sm font-medium text-text-primary dark:text-text-primary-dark">
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
