import { GitBranchPlus, RefreshCw } from "lucide-react";
import { Button } from "../atoms/Button";
import { IconButton } from "../atoms/IconButton";
import { Select } from "../atoms/Select";
import { FormField } from "../molecules/FormField";
import { ToggleSetting } from "../molecules/ToggleSetting";
import type { GitRepositoryFieldProps } from "../../types";


/** What the list's first, unchoosable line says: listing, nothing to list, or choose. */
function placeholder({ mode, list, showAll }: Pick<GitRepositoryFieldProps, "mode" | "list" | "showAll">): string {
  if (list.loading) return "Listing repositories…";
  if (list.repositories.length > 0) return "Choose a repository";
  if (mode === "connect") return "No empty repository you can push to";
  return showAll ? "No repository" : "No repository tagged apiweave-workspace";
}

/**
 * Repository, from one account's own list, with a Refresh; in `open` mode
 * the Show all repositories switch; and Use a URL instead for anything the
 * list does not hold.
 */
export function GitRepositoryField({
  mode,
  account,
  list,
  picked,
  onPick,
  onCreateRepository,
  showAll,
  onToggleShowAll,
  onUseUrl,
  disabled,
}: GitRepositoryFieldProps) {
  return (
    <>
      <div className="flex items-end gap-2">
        <FormField label="Repository" className="flex-1">
          <Select
            aria-label="Repository"
            value={picked}
            disabled={disabled || list.loading}
            onChange={(event) => onPick(list.repositories.find((repository) => repository.fullName === event.target.value) ?? null)}
          >
            <option value="" disabled>
              {placeholder({ mode, list, showAll })}
            </option>

            {list.repositories.map((repository) => (
              <option key={repository.fullName} value={repository.fullName}>
                {repository.fullName}
                {repository.private ? " (private)" : ""}
              </option>
            ))}
          </Select>
        </FormField>
        <IconButton
          tooltip="Refresh repositories"
          aria-label="Refresh repositories"
          size="sm"
          disabled={disabled || list.loading}
          onClick={list.refresh}
          className="mb-1"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </IconButton>
      </div>
      {/* A button, not an option: a native select fires a chosen option on ArrowDown, which would open a dialog. */}
      {mode === "connect" && onCreateRepository !== undefined && (
        <Button
          variant={list.repositories.length === 0 && !list.loading ? "primary" : "secondary"}
          size="sm"
          icon={<GitBranchPlus className="h-4 w-4" aria-hidden="true" />}
          disabled={disabled}
          onClick={() => onCreateRepository(account)}
        >
          Create repository…
        </Button>
      )}
      {mode === "open" && (
        <ToggleSetting
          title="Show all repositories"
          description="Off: only repositories tagged apiweave-workspace, the topic APIWeave gives the ones it creates. Add the topic to one made elsewhere to list it here."
          checked={showAll}
          onToggle={onToggleShowAll}
          disabled={disabled}
        />
      )}
      {account.gitProtocol === "ssh" && (
        <p className="text-xs text-text-muted dark:text-text-muted-dark">
          {account.login} uses SSH: the repository is reached by its SSH URL, signed in with your SSH key.
        </p>
      )}
      <Button variant="ghost" size="xs" disabled={disabled} onClick={onUseUrl}>
        Use a URL instead
      </Button>
    </>
  );
}
