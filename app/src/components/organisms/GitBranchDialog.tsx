import { useEffect, useState } from "react";
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import { Button } from "../atoms/Button";
import { Select } from "../atoms/Select";
import { FormField } from "../molecules/FormField";
import { Modal } from "../molecules/Modal";
import { Spinner } from "../atoms/Spinner";
import { git } from "../../utils/apiweaveClient";
import { errorText } from "../../utils/gitRemote";
import type { GitBranchDialogProps } from "../../types";

/**
 * Switch which remote branch the workspace tracks. The list is the remote's,
 * read when the dialog opens; the current branch is named but not offered.
 * The switch itself refuses when this branch has unpushed commits or a merge
 * waits, and the reason is shown here without closing.
 */
export function GitBranchDialog({
  workspaceId,
  currentBranch,
  onClose,
  onSwitched,
}: GitBranchDialogProps) {
  const [branches, setBranches] = useState<readonly string[]>([]);
  const [branch, setBranch] = useState("");
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    git
      .listBranches(workspaceId)
      .then((list) => {
        if (!live) return;
        const options = list.branches.filter((name) => name !== currentBranch);
        setBranches(options);
        setBranch(options[0] ?? "");
      })
      .catch((reason: unknown) => {
        if (live) setError(errorText(reason));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [workspaceId, currentBranch]);

  const switchTo = async (): Promise<void> => {
    if (branch === "" || switching) return;
    setSwitching(true);
    setError(null);
    try {
      const status: WorkspaceGitStatus = await git.switchBranch(
        workspaceId,
        branch,
      );
      onSwitched(status);
      onClose();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSwitching(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={switching ? () => undefined : onClose}
      title="Switch branch"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={switching}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={switching}
            disabled={loading || branch === ""}
            onClick={() => void switchTo()}
          >
            Switch branch
          </Button>
        </>
      }
    >
      <div className="space-y-4 p-5">
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
          This workspace currently tracks{" "}
          <strong className="font-semibold text-text-primary dark:text-text-primary-dark">
            {currentBranch}
          </strong>
          . Switching loads another branch&apos;s files into the workspace. It
          is refused while this branch has commits the remote does not, so
          nothing unpushed is left behind.
        </p>
        {loading ? (
          <Spinner size="sm" />
        ) : branches.length === 0 && error === null ? (
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
            The remote has no other branch to switch to.
          </p>
        ) : (
          <FormField label="Branch">
            <Select
              aria-label="Branch"
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              disabled={switching || branches.length === 0}
            >
              {branches.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        {error !== null && (
          <p
            role="alert"
            className="text-sm text-status-error dark:text-(--aw-status-error)"
          >
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
