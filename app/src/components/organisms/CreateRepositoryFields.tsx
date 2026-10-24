import { useEffect } from "react";
import { GitRepositoryNameSchema } from "@shared/zod-schemas/GitCreateRepositoryRequestSchema";
import { Input } from "../atoms/Input";
import { Select } from "../atoms/Select";
import { FormField } from "../molecules/FormField";
import { useGitRepositoryOwners } from "../../hooks/useGitRepositoryOwners";
import { gitAccountKey } from "../../utils/gitAccounts";
import type { CreateRepositoryFieldsProps, GitRepositoryDraft } from "../../types";

const OWNER_KINDS = { user: "your account", organization: "organization", group: "group" } as const;

/** Why `name` is not a repository name APIWeave can create, or null when it is (or is still empty). */
export function repositoryNameError(name: string): string | null {
  if (name.trim() === "") return null;
  const checked = GitRepositoryNameSchema.safeParse(name.trim());
  return checked.success ? null : `${checked.error.issues[0]?.message ?? "Not a repository name"}.`.replace(/^./, (first) => first.toUpperCase());
}

/** Whether `draft` names everything a repository needs to be created. */
export function isRepositoryDraftReady(draft: GitRepositoryDraft): boolean {
  return draft.account !== null && draft.owner !== "" && draft.name.trim() !== "" && repositoryNameError(draft.name) === null;
}

/**
 * What a new repository is: the account to create it as, the owner (the
 * account or one of its organizations or groups), its name and whether it is
 * private. Shared by Version history's Create repository and Create
 * workspace's sync section.
 */
export function CreateRepositoryFields({ value, onChange, accounts, disabled = false }: CreateRepositoryFieldsProps) {
  const { owners, problem, loading } = useGitRepositoryOwners(value.account);
  const nameError = repositoryNameError(value.name);

  // A new account's owners replace the last one's: start on the account itself. An owner already
  // chosen stays — it may be one the list does not hold, as a handed-on draft's can be — and stays listed.
  const chosen = value.owner === "" ? undefined : owners.find((owner) => owner.path === value.owner);
  useEffect(() => {
    const first = owners[0];
    if (value.owner === "" && first !== undefined) onChange({ ...value, owner: first.path });
  }, [owners, value, onChange]);

  return (
    <div className="space-y-3">
      <FormField label="Account" required>
        <Select
          aria-label="Account"
          value={value.account === null ? "" : gitAccountKey(value.account)}
          disabled={disabled}
          onChange={(event) => {
            const account = accounts.find((candidate) => gitAccountKey(candidate) === event.target.value) ?? null;
            onChange({ ...value, account, owner: "" });
          }}
        >
          <option value="" disabled>
            Choose an account
          </option>
          {accounts.map((account) => (
            <option key={gitAccountKey(account)} value={gitAccountKey(account)}>
              {account.login} on {account.host}
              {account.gitProtocol === "ssh" ? " (SSH)" : ""}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Owner" required>
        <Select
          aria-label="Owner"
          value={value.owner}
          disabled={disabled || value.account === null || loading || owners.length === 0}
          onChange={(event) => onChange({ ...value, owner: event.target.value })}
        >
          {loading && <option value="">Listing organizations and groups…</option>}
          {chosen === undefined && value.owner !== "" && <option value={value.owner}>{value.owner}</option>}
          {owners.map((owner) => (
            <option key={owner.path} value={owner.path}>
              {owner.path} ({OWNER_KINDS[owner.kind]})
            </option>
          ))}
        </Select>
        {/* A list that is short rather than wrong: a warning under the field, not an error on it. */}
        {problem !== null && <p className="mt-1 text-xs text-status-warning">{problem}</p>}
      </FormField>
      <FormField label="Repository name" required {...(nameError === null ? {} : { error: nameError })}>
        <Input
          aria-label="Repository name"
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={nameError !== null}
        />
      </FormField>
      <FormField label="Visibility" hint="Private: only people you invite can see it. You can change this on the host later.">
        <Select
          aria-label="Visibility"
          value={value.private ? "private" : "public"}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, private: event.target.value === "private" })}
        >
          <option value="private">Private</option>
          <option value="public">Public</option>
        </Select>
      </FormField>
    </div>
  );
}
