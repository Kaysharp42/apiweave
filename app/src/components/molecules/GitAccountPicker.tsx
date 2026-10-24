import type { GitAccountRef } from "@shared/types/GitAccountRef";
import type { GitAccountPickerProps } from "../../types";
import { FormField } from "./FormField";

/** The option a choice of no account stands for: whatever git would do on its own. */
const OWN_CREDENTIALS = "";

const keyOf = (account: GitAccountRef): string =>
  `${account.provider}|${account.host}|${account.login}`;

const sameAccount = (a: GitAccountRef, b: GitAccountRef): boolean =>
  keyOf(a) === keyOf(b);

const hostname = (host: string): string => host.replace(/:\d+$/, "").toLowerCase();

/**
 * Which `gh`/`glab` account a workspace's remote is reached as, or none — the
 * user's own credential helper or SSH key, as before accounts existed. Only
 * accounts on the remote's host are offered; a bound account that is no
 * longer signed in stays listed, so the choice is never silently changed.
 */
export function GitAccountPicker({
  accounts,
  host,
  value,
  onChange,
  disabled = false,
}: GitAccountPickerProps) {
  const listed = value === null ? undefined : accounts.find((account) => sameAccount(account, value));
  // The chosen account stays an option even when the URL now names another host: the server says why it does not fit.
  const offered = accounts.filter(
    (account) =>
      host === null || hostname(account.host) === host.toLowerCase() || account === listed,
  );
  const signedOut = value !== null && listed === undefined;
  return (
    <FormField
      label="Account"
      hint="APIWeave asks gh or glab for this account's token on every sync and stores none."
    >
      <select
        aria-label="Account"
        value={value === null ? OWN_CREDENTIALS : keyOf(value)}
        disabled={disabled}
        onChange={(event) => {
          const picked = [...offered, ...(value === null ? [] : [value])].find(
            (account) => keyOf(account) === event.target.value,
          );
          // Only what names the account crosses the bridge, which refuses anything more.
          onChange(
            picked === undefined
              ? null
              : { provider: picked.provider, host: picked.host, login: picked.login },
          );
        }}
        className="w-full rounded-sm border border-border bg-surface-raised px-2 py-1.5 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] disabled:opacity-60 dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark"
      >
        <option value={OWN_CREDENTIALS}>Your own git sign-in (credential manager or SSH key)</option>
        {offered.map((account) => (
          <option key={keyOf(account)} value={keyOf(account)}>
            {account.login} on {account.host}
            {account.problem === null ? "" : " — sign-in needs attention"}
          </option>
        ))}
        {signedOut && (
          <option value={keyOf(value)}>
            {value.login} on {value.host} — not signed in
          </option>
        )}
      </select>
    </FormField>
  );
}
