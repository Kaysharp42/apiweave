import { Select } from "../atoms/Select";
import { FormField } from "./FormField";
import { gitAccountKey } from "../../utils/gitAccounts";
import type { GitRemoteAccountSelectProps } from "../../types";

/** How an account reads in the list: its login and host, how it signs in when that is SSH, and a sign-in that needs attention. */
function accountLabel(account: GitRemoteAccountSelectProps["accounts"][number]): string {
  const ssh = account.gitProtocol === "ssh" ? " (SSH)" : "";
  const attention = account.problem === null ? "" : " — sign-in needs attention";
  return `${account.login} on ${account.host}${ssh}${attention}`;
}

/** Account, for a remote: every `gh`/`glab` account, and last, another host with the user's own git sign-in (the empty value). */
export function GitRemoteAccountSelect({ accounts, value, onChange, disabled }: GitRemoteAccountSelectProps) {
  return (
    <FormField label="Account">
      <Select aria-label="Account" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {accounts.map((account) => (
          <option key={gitAccountKey(account)} value={gitAccountKey(account)}>
            {accountLabel(account)}
          </option>
        ))}
        <option value="">Another host — your own git sign-in</option>
      </Select>
    </FormField>
  );
}
