import { useState } from "react";
import { RefreshCw } from "lucide-react";
import type { GitProvider } from "@shared/types/GitProvider";
import { Button } from "../atoms/Button";
import { Spinner } from "../atoms/Spinner";
import { Card } from "../molecules/Card";
import { GitAccountRow } from "../molecules/GitAccountRow";
import { GitCliState } from "../molecules/GitCliState";
import { GitSignInDialog } from "./GitSignInDialog";
import { useGitAccounts } from "../../hooks/useGitAccounts";
import { useGitAccountWorkspaces } from "../../hooks/useGitAccountWorkspaces";
import { git } from "../../utils/apiweaveClient";
import {
  GIT_PROVIDERS,
  gitAccountKey,
  groupGitAccountsByHost,
} from "../../utils/gitAccounts";
import type { GitHostCliCardProps } from "../../types";

function GitHostCliCard({
  provider,
  cli,
  groups,
  usedBy,
  onSignIn,
}: GitHostCliCardProps) {
  const tool = GIT_PROVIDERS[provider];
  const accounts = groups.flatMap((group) => group.accounts);
  return (
    <Card
      title={tool.cliName}
      headerActions={
        <Button
          size="sm"
          variant="secondary"
          disabled={cli?.missing !== false}
          onClick={onSignIn}
        >
          Sign in…
        </Button>
      }
    >
      <div className="space-y-3">
        <GitCliState cli={cli} />
        {cli !== undefined && !cli.missing && cli.problem !== null && (
          <p className="text-xs text-status-warning">{cli.problem}</p>
        )}
        {provider === "gitlab" && (
          <p className="text-xs text-text-muted dark:text-text-muted-dark">
            glab keeps one account per host. Signing in to a host it already has
            replaces that account, so a second GitLab account needs a different
            host.
          </p>
        )}
        {cli !== undefined && !cli.missing && accounts.length === 0 && (
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
            No {tool.name} account is signed in.
          </p>
        )}
        <ul className="space-y-3">
          {accounts.map((account) => {
            const names = usedBy.get(gitAccountKey(account)) ?? [];
            return (
              <li key={gitAccountKey(account)}>
                <GitAccountRow
                  account={account}
                  detail={
                    <p className="text-xs text-text-muted dark:text-text-muted-dark">
                      {names.length === 0
                        ? "No workspace uses this account."
                        : `Used by ${names.join(", ")}.`}
                    </p>
                  }
                />
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}

/**
 * Settings > Git accounts: whether `gh` and `glab` are installed, with where
 * to get them when they are not; every account each is signed in to, and the
 * workspaces that sync as it; and signing in to another. APIWeave stores no
 * account or token itself — this is what the two tools hold.
 */
export function GitAccountsSettingsPanel() {
  const available = git.isAvailable();
  const { accounts, clis, failure, loaded, loading, reload } = useGitAccounts();
  const usedBy = useGitAccountWorkspaces();
  const [signingIn, setSigningIn] = useState<GitProvider | null>(null);

  if (!available) {
    return (
      <p className="text-xs text-status-warning">
        Git accounts are only available in the desktop app.
      </p>
    );
  }

  const groups = groupGitAccountsByHost(accounts);
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
          APIWeave signs in to GitHub and GitLab with their own command-line
          tools, which keep your tokens in the system keychain. A workspace
          connected to a repository on github.com or a GitLab host can sync as
          any of these accounts.
        </p>
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
          loading={loading}
          disabled={loading}
          onClick={reload}
        >
          Refresh
        </Button>
      </div>
      <div aria-live="polite" aria-busy={loading} className="space-y-4">
        {!loaded ? (
          <div className="flex items-center gap-2 text-sm text-text-secondary dark:text-text-secondary-dark">
            <Spinner size="sm" />
            Checking your GitHub and GitLab sign-ins…
          </div>
        ) : (
          (["github", "gitlab"] as const).map((provider) => (
            <GitHostCliCard
              key={provider}
              provider={provider}
              cli={clis.find((cli) => cli.provider === provider)}
              groups={groups.filter((group) => group.provider === provider)}
              usedBy={usedBy}
              onSignIn={() => setSigningIn(provider)}
            />
          ))
        )}
      </div>
      {/* An alert of its own, outside the live region above, so it is announced once. */}
      {failure !== null && (
        <p role="alert" className="text-xs text-status-error">
          Your gh and glab accounts could not be listed: {failure}
        </p>
      )}
      {signingIn !== null && (
        <GitSignInDialog
          isOpen
          provider={signingIn}
          defaultHost={GIT_PROVIDERS[signingIn].defaultHost}
          onClose={() => setSigningIn(null)}
          onSignedIn={reload}
        />
      )}
    </div>
  );
}
