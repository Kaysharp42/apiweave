import { useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { GitBranch, Settings, UserRound } from "lucide-react";
import type { GitAccountRef } from "@shared/types/GitAccountRef";
import type { GitProvider } from "@shared/types/GitProvider";
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import { Button } from "../atoms/Button";
import { GitAccountRow } from "../molecules/GitAccountRow";
import { GitAccountsNotice } from "../molecules/GitAccountsNotice";
import { GitSyncKindIcon } from "../molecules/GitSyncKindIcon";
import { GitSignInDialog } from "../organisms/GitSignInDialog";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useGitAccounts } from "../../hooks/useGitAccounts";
import { git } from "../../utils/apiweaveClient";
import { GIT_PROVIDERS, gitAccountInitials, groupGitAccountsByHost, sameGitAccount } from "../../utils/gitAccounts";
import { GIT_SYNC_INTENT_TEXT, describeGitSync } from "../../utils/gitSync";
import { noDragStyle } from "./WindowControls";
import type { GitAccountsMenuPanelProps, GitAccountsMenuProps, GitSyncView } from "../../types";

/**
 * What the panel lists: read when it opens, so a sign-in made in a terminal
 * since shows up, and nothing runs `gh` or `glab` while the menu is closed.
 */
function GitAccountsMenuPanel({ titleId, current, onAdd, onOpenSettings, onSetUpSync }: GitAccountsMenuPanelProps) {
  const { accounts, clis, problems, loaded } = useGitAccounts();
  const groups = groupGitAccountsByHost(accounts, current);
  const hasGitLab = accounts.some((account) => account.provider === "gitlab");

  return (
    <div className="space-y-3">
      <h2 id={titleId} className="text-sm font-semibold text-text-primary dark:text-text-primary-dark">
        Git accounts
      </h2>
      <div className="space-y-3">
        {groups.map((group) => (
          <section key={`${group.provider}|${group.host}`} aria-label={`${GIT_PROVIDERS[group.provider].name} on ${group.host}`}>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark">
              {group.host}
            </h3>
            <ul className="space-y-2">
              {group.accounts.map((account) => (
                <li key={account.login}>
                  <GitAccountRow account={account} current={sameGitAccount(account, current)} />
                </li>
              ))}
              {group.signedOut !== null && (
                <li>
                  <GitAccountRow account={group.signedOut} current />
                </li>
              )}
            </ul>
          </section>
        ))}
        <GitAccountsNotice
          loaded={loaded}
          empty={groups.length === 0}
          emptyText="No GitHub or GitLab account is signed in on this computer."
          problems={problems}
        />
      </div>
      <div className="space-y-1 border-t border-border pt-3 dark:border-border-dark">
        {onSetUpSync !== null && (
          <Button
            variant="ghost"
            size="sm"
            fullWidth
            className="!justify-start"
            icon={<GitBranch className="h-4 w-4" aria-hidden="true" />}
            onClick={onSetUpSync}
          >
            Set up sync for this workspace…
          </Button>
        )}
        {(["github", "gitlab"] as const).map((provider) => {
          const missing = clis.find((cli) => cli.provider === provider)?.missing === true;
          return (
            <div key={provider}>
              <Button
                variant="ghost"
                size="sm"
                fullWidth
                className="!justify-start"
                disabled={!loaded || missing}
                onClick={() => onAdd(provider)}
              >
                Add {GIT_PROVIDERS[provider].name} account
              </Button>
              {missing && (
                <p className="px-3 text-xs text-text-muted dark:text-text-muted-dark">
                  The {GIT_PROVIDERS[provider].cliName} is not installed; Settings &gt; Git accounts says where to get it.
                </p>
              )}
            </div>
          );
        })}
        {hasGitLab && (
          <p className="px-3 text-xs text-text-muted dark:text-text-muted-dark">
            glab keeps one account per host: signing in to the same GitLab host again replaces its account.
          </p>
        )}
        <Button
          variant="ghost"
          size="sm"
          fullWidth
          className="!justify-start"
          icon={<Settings className="h-4 w-4" aria-hidden="true" />}
          onClick={onOpenSettings}
        >
          Settings &gt; Git accounts
        </Button>
      </div>
    </div>
  );
}

/** The workspace's sync state for the trigger's badge; null when it has none to show. */
function syncBadge(status: WorkspaceGitStatus | null): GitSyncView | null {
  const view = status === null ? null : describeGitSync(status);
  return view !== null && view.icon !== null ? view : null;
}

/** Untracked, or tracked with no remote: the menu is where someone looking for sync starts. */
function needsSyncSetup(status: WorkspaceGitStatus | null): boolean {
  return status !== null && (!status.tracked || status.remoteUrl === null);
}

/** The trigger's name: the menu, the workspace's account, and its sync state, whichever there are. */
function triggerLabel(account: GitAccountRef | null, synced: GitSyncView | null): string {
  return [
    "Git accounts",
    account === null ? null : `this workspace uses ${account.login} on ${account.host}`,
    synced === null ? null : synced.label,
  ]
    .filter((part): part is string => part !== null)
    .join(" — ");
}

/**
 * The header's accounts menu, where the Cloud account menu used to be: the
 * initials of the account the current workspace syncs as (a neutral person
 * when it has none), with the workspace's sync icon as a corner badge. The
 * panel lists every `gh`/`glab` account by host, marks the one this
 * workspace uses, and signs in to another. Absent with no bridge to ask (the
 * browser build).
 */
export function GitAccountsMenu({ status }: GitAccountsMenuProps) {
  const navigate = useNavigate();
  const { currentOrg, currentWorkspace } = useWorkspace();
  const [signingIn, setSigningIn] = useState<GitProvider | null>(null);
  const titleId = useId();
  if (!git.isAvailable()) return null;

  const account = status?.account ?? null;
  const synced = syncBadge(status);
  const settingsBase = `/${currentOrg?.slug ?? "personal"}/${currentWorkspace?.slug ?? "personal"}/settings`;
  const unsynced = currentWorkspace !== null && needsSyncSetup(status);
  const label = triggerLabel(account, synced);

  return (
    <div style={noDragStyle} className="flex items-center">
      <Popover className="relative flex items-center">
        {({ close }) => (
          <>
            <PopoverButton
              as={Button}
              variant="ghost"
              size="sm"
              className="h-9 w-9 !rounded-full border border-border bg-surface-raised !p-0 hover:bg-surface-overlay dark:border-border-dark dark:bg-surface-dark-raised dark:hover:bg-surface-dark-overlay"
              aria-label={label}
              title={label}
            >
              {account === null ? (
                <UserRound className="h-4 w-4 text-text-secondary dark:text-text-secondary-dark" aria-hidden="true" />
              ) : (
                <span className="select-none text-xs font-semibold text-primary dark:text-primary-light" aria-hidden="true">
                  {gitAccountInitials(account.login)}
                </span>
              )}
            </PopoverButton>
            {/* Outside the round trigger, so its edge does not clip the badge. */}
            {synced !== null && (
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-surface-raised ring-1 ring-border dark:bg-surface-dark-raised dark:ring-border-dark ${GIT_SYNC_INTENT_TEXT[synced.intent]}`}
              >
                <GitSyncKindIcon indicator={synced} className="h-3 w-3" />
              </span>
            )}
            <PopoverPanel
              anchor={{ to: "bottom end", gap: 6, padding: 8 }}
              aria-labelledby={titleId}
              className="z-50 w-80 rounded border border-border bg-surface-raised p-3 shadow-overlay focus:outline-none dark:border-border-dark dark:bg-surface-dark-raised"
            >
              <GitAccountsMenuPanel
                titleId={titleId}
                current={account}
                onAdd={(provider) => {
                  close();
                  setSigningIn(provider);
                }}
                onOpenSettings={() => {
                  close();
                  navigate(`${settingsBase}/git-accounts`);
                }}
                onSetUpSync={
                  unsynced
                    ? () => {
                        close();
                        navigate(`${settingsBase}/version-history`);
                      }
                    : null
                }
              />
            </PopoverPanel>
          </>
        )}
      </Popover>
      {signingIn !== null && (
        <GitSignInDialog
          isOpen
          provider={signingIn}
          defaultHost={GIT_PROVIDERS[signingIn].defaultHost}
          onClose={() => setSigningIn(null)}
          onSignedIn={() => undefined}
        />
      )}
    </div>
  );
}
