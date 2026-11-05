import { useEffect, useState } from "react";
import type { GitBranchList } from "@shared/types/GitBranchList";
import { Button } from "../atoms/Button";
import { Select } from "../atoms/Select";
import { FormField } from "../molecules/FormField";
import { BranchOptions } from "./BranchOptions";
import { git } from "../../utils/apiweaveClient";
import { errorText } from "../../utils/gitRemote";
import type { RemoteBranchChooserProps } from "../../types";

/**
 * The branch a workspace is cloned from or connects to: nothing until the user
 * asks for the remote's list — the default branch needs no call beyond the
 * clone — then the list, with the default first, and why it could not be read
 * if it could not. Choosing a new remote drops the list from the last one.
 */
export function RemoteBranchChooser({
  selection,
  branch,
  hint,
  disabled,
  onBranchChange,
}: RemoteBranchChooserProps) {
  const [list, setList] = useState<GitBranchList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setList(null);
    setError(null);
  }, [selection]);

  const load = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setList(await git.listRemoteBranches(selection.url, selection.account));
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {list === null ? (
        <Button
          type="button"
          variant="ghost"
          loading={busy}
          disabled={disabled}
          onClick={() => void load()}
        >
          Choose branch…
        </Button>
      ) : (
        <FormField label="Branch" hint={hint}>
          <Select
            aria-label="Branch"
            value={branch}
            onChange={(event) => onBranchChange(event.target.value)}
            disabled={disabled}
          >
            <option value="">
              Default branch
              {list.defaultBranch === null ? "" : ` (${list.defaultBranch})`}
            </option>
            <BranchOptions names={list.branches} />
          </Select>
        </FormField>
      )}
      {error !== null && (
        <p role="status" className="text-xs text-status-warning">
          Could not list the repository&apos;s branches: {error}
        </p>
      )}
    </div>
  );
}
