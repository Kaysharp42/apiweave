import { useEffect, useState } from "react";
import { GitAccountsNotice } from "../molecules/GitAccountsNotice";
import { CreateRepositoryFields } from "./CreateRepositoryFields";
import { GitSignInButtons } from "./GitSignInButtons";
import { useGitAccounts } from "../../hooks/useGitAccounts";
import { gitAccountKey, sameGitAccount } from "../../utils/gitAccounts";
import type { CreateRepositorySectionProps } from "../../types";

/**
 * Everything a new repository needs from the user, with the accounts it can
 * be created as: listed when it mounts, the default one chosen once they
 * are, a sign-in to add another, and why there are none when there are none.
 * Version history's Create repository dialog is this, and so is Create
 * workspace's sync section.
 */
export function CreateRepositorySection({ value, onChange, defaultAccount, disabled = false }: CreateRepositorySectionProps) {
  const { accounts, clis, problems, loaded, reload } = useGitAccounts();
  // An account just signed in to, chosen as soon as the tools list it.
  const [signedIn, setSignedIn] = useState<string | null>(null);

  // Start on the account asked for, else the one its tool has active, else the first; then on one just signed in to.
  useEffect(() => {
    if (signedIn !== null) {
      const added = accounts.find((account) => gitAccountKey(account) === signedIn);
      if (added === undefined) return;
      setSignedIn(null);
      onChange({ ...value, account: added, owner: "" });
      return;
    }
    if (value.account !== null || accounts.length === 0) return;
    const preferred = accounts.find((account) => sameGitAccount(account, defaultAccount)) ?? accounts.find((account) => account.active) ?? accounts[0];
    onChange({ ...value, account: preferred ?? null, owner: "" });
  }, [accounts, value, onChange, defaultAccount, signedIn]);

  return (
    <div className="space-y-3">
      <GitAccountsNotice
        loaded={loaded}
        empty={accounts.length === 0}
        emptyText="Sign in to GitHub or GitLab first: APIWeave creates the repository as one of your accounts."
        problems={problems}
      />
      {loaded && accounts.length > 0 && <CreateRepositoryFields value={value} onChange={onChange} accounts={accounts} disabled={disabled} />}
      {loaded && (
        <GitSignInButtons
          clis={clis}
          disabled={disabled}
          onSignedIn={(account) => {
            setSignedIn(gitAccountKey(account));
            reload();
          }}
        />
      )}
    </div>
  );
}
