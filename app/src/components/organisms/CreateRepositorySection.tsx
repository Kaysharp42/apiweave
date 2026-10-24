import { useEffect, useState } from "react";
import type { GitProvider } from "@shared/types/GitProvider";
import { Button } from "../atoms/Button";
import { Spinner } from "../atoms/Spinner";
import { CreateRepositoryFields } from "./CreateRepositoryFields";
import { GitSignInDialog } from "./GitSignInDialog";
import { useGitAccounts } from "../../hooks/useGitAccounts";
import { GIT_PROVIDERS, gitAccountKey, sameGitAccount } from "../../utils/gitAccounts";
import type { CreateRepositorySectionProps } from "../../types";

/**
 * Everything a new repository needs from the user, with the accounts it can
 * be created as: listed when it mounts, the default one chosen once they
 * are, a sign-in to add another, and why there are none when there are none.
 * Version history's Create repository dialog and Create workspace's sync
 * section are both this.
 */
export function CreateRepositorySection({ value, onChange, defaultAccount, disabled = false }: CreateRepositorySectionProps) {
  const { accounts, problems, loaded, reload } = useGitAccounts();
  const [signingIn, setSigningIn] = useState<GitProvider | null>(null);
  // An account just signed in to, chosen as soon as the tools list it.
  const [signedIn, setSignedIn] = useState<string | null>(null);

  // Start on the account asked for, else the first; then on one just signed in to.
  useEffect(() => {
    if (signedIn !== null) {
      const added = accounts.find((account) => gitAccountKey(account) === signedIn);
      if (added === undefined) return;
      setSignedIn(null);
      onChange({ ...value, account: added, owner: "" });
      return;
    }
    if (value.account !== null || accounts.length === 0) return;
    onChange({ ...value, account: accounts.find((account) => sameGitAccount(account, defaultAccount)) ?? accounts[0] ?? null, owner: "" });
  }, [accounts, value, onChange, defaultAccount, signedIn]);

  return (
    <div className="space-y-3">
      <div aria-live="polite" className="space-y-2">
        {!loaded && (
          <div className="flex items-center gap-2 text-sm text-text-secondary dark:text-text-secondary-dark">
            <Spinner size="sm" />
            Asking gh and glab…
          </div>
        )}
        {loaded && accounts.length === 0 && (
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
            Sign in to GitHub or GitLab first: APIWeave creates the repository as one of your accounts.
          </p>
        )}
        {problems.map((problem) => (
          <p key={problem} className="text-xs text-status-warning">
            {problem}
          </p>
        ))}
      </div>
      {loaded && accounts.length > 0 && <CreateRepositoryFields value={value} onChange={onChange} accounts={accounts} disabled={disabled} />}
      {loaded && (
        <div className="flex flex-wrap gap-2">
          {(["github", "gitlab"] as const).map((provider) => (
            <Button key={provider} variant="ghost" size="sm" disabled={disabled} onClick={() => setSigningIn(provider)}>
              Sign in to {GIT_PROVIDERS[provider].name}…
            </Button>
          ))}
        </div>
      )}
      {signingIn !== null && (
        <GitSignInDialog
          isOpen
          provider={signingIn}
          defaultHost={GIT_PROVIDERS[signingIn].defaultHost}
          onClose={() => setSigningIn(null)}
          onSignedIn={(account) => {
            setSignedIn(gitAccountKey(account));
            reload();
          }}
        />
      )}
    </div>
  );
}
