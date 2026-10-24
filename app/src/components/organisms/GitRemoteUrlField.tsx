import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { FormField } from "../molecules/FormField";
import type { GitRemoteUrlFieldProps } from "../../types";

/** Repository URL, for another host or a repository an account's list does not hold, and the way back to that list. */
export function GitRemoteUrlField({ url, onChange, account, onBackToList, disabled }: GitRemoteUrlFieldProps) {
  return (
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
          onChange={(event) => onChange(event.target.value)}
          placeholder="https://host/owner/repo.git or git@host:owner/repo.git"
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
        />
      </FormField>
      {account !== null && (
        <Button variant="ghost" size="xs" disabled={disabled} onClick={onBackToList}>
          Choose from {account.login}&apos;s repositories
        </Button>
      )}
    </>
  );
}
