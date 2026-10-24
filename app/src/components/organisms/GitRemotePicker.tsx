import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { GitAccount } from "@shared/types/GitAccount";
import type { GitProvider } from "@shared/types/GitProvider";
import { Button } from "../atoms/Button";
import { IconButton } from "../atoms/IconButton";
import { Input } from "../atoms/Input";
import { Select } from "../atoms/Select";
import { Spinner } from "../atoms/Spinner";
import { FormField } from "../molecules/FormField";
import { ToggleSetting } from "../molecules/ToggleSetting";
import { GitSignInDialog } from "./GitSignInDialog";
import { useGitAccounts } from "../../hooks/useGitAccounts";
import { useGitRepositoryList } from "../../hooks/useGitRepositoryList";
import { GIT_PROVIDERS, gitAccountKey, gitAccountRef } from "../../utils/gitAccounts";
import { remoteForRepository } from "../../utils/gitRepositories";
import type { GitRemotePickerProps, GitRemoteSelection } from "../../types";

/** The account option that stands for none: a URL on any host, with the user's own git sign-in. */
const NO_ACCOUNT = "";
/** The repository option that opens Create repository… instead of choosing one. */
const CREATE = "create";
const HTTPS_URL = /^https:\/\//i;

/** A typed URL, reached as the account when it is an `https://` one and the account signs in over HTTPS; the server checks the host. */
function typedRemote(url: string, account: GitAccount | null): GitRemoteSelection | null {
  const trimmed = url.trim();
  if (trimmed === "") return null;
  return { url: trimmed, account: account !== null && account.gitProtocol === "https" && HTTPS_URL.test(trimmed) ? gitAccountRef(account) : null };
}

/**
 * Account first, then Repository from the account's own list, with Use a
 * URL instead for other hosts and anything not listed. In `connect` mode the
 * list holds the account's empty repositories it can push to, with Create
 * repository… first; in `open` mode its `apiweave-workspace` repositories,
 * with Show all repositories. An HTTPS account's choice is its HTTPS URL,
 * bound to it; an SSH account's is its SSH URL, bound to none. Each list is
 * kept for as long as the picker is open, with Refresh.
 */
export function GitRemotePicker({ mode, initial, onChange, onCreateRepository, disabled = false }: GitRemotePickerProps) {
  const { accounts, problems: accountProblems, loaded, reload } = useGitAccounts();
  const [chosenKey, setChosenKey] = useState<string | null>(initial === null ? null : initial.account === null ? NO_ACCOUNT : gitAccountKey(initial.account));
  const [urlMode, setUrlMode] = useState(initial !== null);
  const [url, setUrl] = useState(initial?.url ?? "");
  const [picked, setPicked] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [signingIn, setSigningIn] = useState<GitProvider | null>(null);

  // Until the user picks: the first account, so the list is there on opening.
  const accountKey = chosenKey ?? (accounts[0] === undefined ? NO_ACCOUNT : gitAccountKey(accounts[0]));
  const account = accounts.find((candidate) => gitAccountKey(candidate) === accountKey) ?? null;
  const listing = account !== null && !urlMode;
  const { repositories, problems, loading, refresh } = useGitRepositoryList(listing ? account : null, {
    tagged: mode === "open" && !showAll,
    emptyOnly: mode === "connect",
  });
  const repository = repositories.find((candidate) => candidate.fullName === picked) ?? null;

  const selection: GitRemoteSelection | null = listing
    ? repository === null
      ? null
      : remoteForRepository(account, repository)
    : typedRemote(url, account);
  const selectionKey = selection === null ? "" : `${selection.url}\n${selection.account === null ? "" : gitAccountKey(selection.account)}`;
  useEffect(() => {
    onChange(selection);
    // The key is the selection; its object is new on every render.
  }, [selectionKey]);

  const chooseAccount = (key: string): void => {
    setChosenKey(key);
    setPicked("");
    setUrlMode(key === NO_ACCOUNT);
  };

  const emptyLabel = mode === "connect" ? "No empty repository you can push to" : showAll ? "No repository" : "No repository tagged apiweave-workspace";

  return (
    <div className="space-y-3">
      <FormField label="Account">
        <Select aria-label="Account" value={accountKey} disabled={disabled || !loaded} onChange={(event) => chooseAccount(event.target.value)}>
          {accounts.map((candidate) => (
            <option key={gitAccountKey(candidate)} value={gitAccountKey(candidate)}>
              {candidate.login} on {candidate.host}
              {candidate.gitProtocol === "ssh" ? " (SSH)" : ""}
              {candidate.problem === null ? "" : " — sign-in needs attention"}
            </option>
          ))}
          <option value={NO_ACCOUNT}>Another host — your own git sign-in</option>
        </Select>
      </FormField>
      <div className="flex flex-wrap gap-2">
        {(["github", "gitlab"] as const).map((provider) => (
          <Button key={provider} variant="ghost" size="xs" disabled={disabled} onClick={() => setSigningIn(provider)}>
            Sign in to {GIT_PROVIDERS[provider].name}…
          </Button>
        ))}
      </div>

      {listing && (
        <>
          <div className="flex items-end gap-2">
            <FormField label="Repository" className="flex-1">
              <Select
                aria-label="Repository"
                value={picked}
                disabled={disabled || loading}
                onChange={(event) => {
                  if (event.target.value === CREATE) onCreateRepository?.(account);
                  else setPicked(event.target.value);
                }}
              >
                <option value="" disabled>
                  {loading ? "Listing repositories…" : repositories.length === 0 ? emptyLabel : "Choose a repository"}
                </option>
                {mode === "connect" && onCreateRepository !== undefined && <option value={CREATE}>Create repository…</option>}
                {repositories.map((candidate) => (
                  <option key={candidate.fullName} value={candidate.fullName}>
                    {candidate.fullName}
                    {candidate.private ? " (private)" : ""}
                  </option>
                ))}
              </Select>
            </FormField>
            <IconButton tooltip="Refresh repositories" aria-label="Refresh repositories" size="sm" disabled={disabled || loading} onClick={refresh} className="mb-1">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </div>
          {mode === "open" && (
            <ToggleSetting
              title="Show all repositories"
              description="Off: only repositories tagged apiweave-workspace, the topic APIWeave gives the ones it creates. Add the topic to one made elsewhere to list it here."
              checked={showAll}
              onToggle={() => {
                setShowAll(!showAll);
                setPicked("");
              }}
              disabled={disabled}
            />
          )}
          {account.gitProtocol === "ssh" && (
            <p className="text-xs text-text-muted dark:text-text-muted-dark">
              {account.login} uses SSH: the repository is reached by its SSH URL, signed in with your SSH key.
            </p>
          )}
          <Button variant="ghost" size="xs" disabled={disabled} onClick={() => setUrlMode(true)}>
            Use a URL instead
          </Button>
        </>
      )}

      {!listing && (
        <>
          <FormField
            label="Repository URL"
            hint={
              account === null
                ? "Any git host. Git signs in with your own credential manager or SSH key."
                : `An https:// URL on ${account.host} is reached as ${account.login}; any other, with your own git sign-in.`
            }
          >
            <Input
              aria-label="Repository URL"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://host/owner/repo.git or git@host:owner/repo.git"
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
            />
          </FormField>
          {account !== null && (
            <Button variant="ghost" size="xs" disabled={disabled} onClick={() => setUrlMode(false)}>
              Choose from {account.login}&apos;s repositories
            </Button>
          )}
        </>
      )}

      <div aria-live="polite" className="space-y-1">
        {!loaded && (
          <div className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
            <Spinner size="sm" />
            Asking gh and glab for your accounts…
          </div>
        )}
        {[...accountProblems, ...(listing ? problems : [])].map((problem) => (
          <p key={problem} className="text-xs text-status-warning">
            {problem}
          </p>
        ))}
      </div>

      {signingIn !== null && (
        <GitSignInDialog
          isOpen
          provider={signingIn}
          defaultHost={GIT_PROVIDERS[signingIn].defaultHost}
          onClose={() => setSigningIn(null)}
          onSignedIn={(signedIn) => {
            reload();
            chooseAccount(gitAccountKey(signedIn));
          }}
        />
      )}
    </div>
  );
}
