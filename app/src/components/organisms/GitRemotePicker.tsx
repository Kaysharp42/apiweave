import { GitAccountsNotice } from "../molecules/GitAccountsNotice";
import { GitRemoteAccountSelect } from "../molecules/GitRemoteAccountSelect";
import { GitRemoteUrlField } from "./GitRemoteUrlField";
import { GitRepositoryField } from "./GitRepositoryField";
import { GitSignInButtons } from "./GitSignInButtons";
import { useGitRemotePicker } from "../../hooks/useGitRemotePicker";
import type { GitRemotePickerProps } from "../../types";

/**
 * Account first, then Repository from the account's own list, with Use a
 * URL instead for other hosts and anything not listed. In `connect` mode the
 * list holds the account's empty repositories it can push to, with Create
 * repository… first; in `open` mode its `apiweave-workspace` repositories,
 * with Show all repositories. An HTTPS account's choice is its HTTPS URL,
 * bound to it; an SSH account's is its SSH URL, bound to none. Each list is
 * kept for as long as the picker is open, with Refresh.
 */
export function GitRemotePicker({
  mode,
  initial,
  onChange,
  accounts,
  onCreateRepository,
  disabled = false,
}: GitRemotePickerProps) {
  const picker = useGitRemotePicker({ mode, initial, onChange, accounts });
  return (
    <div className="space-y-3">
      {picker.accounts.length > 0 && (
        <GitRemoteAccountSelect
          accounts={picker.accounts}
          value={picker.accountKey}
          onChange={picker.chooseAccount}
          disabled={disabled}
        />
      )}
      {picker.loaded && (
        <GitSignInButtons
          clis={picker.clis}
          disabled={disabled}
          onSignedIn={picker.signedIn}
        />
      )}
      {/* Nothing before the tools answer: the URL field would stand in for an account list about to arrive. */}
      {!picker.loaded ? null : picker.listedAccount === null ? (
        <GitRemoteUrlField
          url={picker.url}
          onChange={picker.setUrl}
          account={picker.account}
          onBackToList={() => picker.showUrlField(false)}
          disabled={disabled}
        />
      ) : (
        <GitRepositoryField
          mode={mode}
          account={picker.listedAccount}
          list={picker.list}
          picked={picker.picked?.fullName ?? ""}
          onPick={picker.pick}
          {...(onCreateRepository === undefined ? {} : { onCreateRepository })}
          showAll={picker.showAll}
          onToggleShowAll={picker.toggleShowAll}
          onUseUrl={() => picker.showUrlField(true)}
          disabled={disabled}
        />
      )}
      <GitAccountsNotice
        loaded={picker.loaded}
        empty={picker.accounts.length === 0}
        emptyText={null}
        problems={picker.problems}
      />
    </div>
  );
}
