import { useEffect, useState } from "react";
import { FileClock, RotateCcw } from "lucide-react";
import type { WorkflowNode } from "@shared/types/WorkflowNode";
import type { WorkflowRevision } from "@shared/types/WorkflowRevision";
import type { WorkflowRevisionSummary } from "@shared/types/WorkflowRevisionSummary";
import { apiweave } from "../../utils/apiweaveClient";
import { revisionDiff, revisionSourceLabel } from "../../utils/revisionDiff";
import { Button } from "../atoms/Button";
import { ConfirmDialog } from "../molecules/ConfirmDialog";
import { Modal } from "../molecules/Modal";
import type { VersionHistoryDialogProps } from "../../types/VersionHistoryDialogProps";

/**
 * A workflow's earlier versions — each the workflow just before a write
 * replaced it — with what restoring one would change, and the restore itself.
 * Restoring is undoable: it keeps the version it replaces like any other write.
 */
export function VersionHistoryDialog({
  workspaceId,
  workflowId,
  onClose,
  onRestore,
}: VersionHistoryDialogProps) {
  const [revisions, setRevisions] = useState<WorkflowRevisionSummary[] | null>(null);
  const [currentNodes, setCurrentNodes] = useState<readonly WorkflowNode[]>([]);
  const [selected, setSelected] = useState<WorkflowRevision | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      apiweave.workflows.listRevisions(workspaceId, workflowId),
      apiweave.workflows.get(workspaceId, workflowId),
    ])
      .then(([list, workflow]) => {
        if (cancelled) return;
        setRevisions(list);
        setCurrentNodes(workflow.nodes);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the version history.");
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, workflowId]);

  const select = async (revisionId: string): Promise<void> => {
    setError(null);
    try {
      setSelected(await apiweave.workflows.getRevision(workspaceId, workflowId, revisionId));
    } catch {
      setError("Could not read that version.");
    }
  };

  const restore = async (): Promise<void> => {
    setConfirming(false);
    if (selected === null) return;
    setRestoring(true);
    try {
      await onRestore(selected.revisionId);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not restore that version.");
    } finally {
      setRestoring(false);
    }
  };

  const diff = selected ? revisionDiff(currentNodes, selected.snapshot.nodes) : null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Version history"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-text-muted dark:text-text-muted-dark" aria-live="polite">
            {diff === null
              ? "Pick a version to see what restoring it changes."
              : `Restoring it: ${diff.added} node${diff.added === 1 ? "" : "s"} added, ${diff.removed} removed, ${diff.changed} changed.`}
          </p>
          <Button
            variant="primary"
            size="sm"
            icon={<RotateCcw className="w-3.5 h-3.5" />}
            disabled={selected === null}
            loading={restoring}
            onClick={() => setConfirming(true)}
          >
            Restore
          </Button>
        </div>
      }
    >
      <p className="px-5 pt-3 text-xs text-text-muted dark:text-text-muted-dark">
        Each version is this workflow as it was just before a change replaced it. Versions stay on
        this computer and are never synced.
      </p>
      {error !== null && (
        <p role="alert" className="px-5 py-2 text-xs text-status-error dark:text-status-error">
          {error}
        </p>
      )}
      {revisions === null ? (
        <p className="px-5 py-8 text-center text-sm text-text-muted dark:text-text-muted-dark">
          Loading versions…
        </p>
      ) : revisions.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-10 text-center">
          <FileClock className="mb-3 h-10 w-10 text-text-muted dark:text-text-muted-dark" aria-hidden="true" />
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">No earlier versions yet</p>
          <p className="text-xs text-text-muted dark:text-text-muted-dark">
            A version is kept every few minutes while you edit, and before any agent, import or sync change.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-0.5 px-3 py-2" role="listbox" aria-label="Versions">
          {revisions.map((revision) => (
            <Button
              key={revision.revisionId}
              variant="ghost"
              fullWidth
              role="option"
              aria-selected={selected?.revisionId === revision.revisionId}
              onClick={() => void select(revision.revisionId)}
              className={`justify-between px-3 py-2 text-left ${
                selected?.revisionId === revision.revisionId
                  ? "bg-primary/10 dark:bg-primary-light/10"
                  : ""
              }`}
            >
              <span className="min-w-0 truncate text-sm">
                Before {revisionSourceLabel(revision.source)}
                <span className="ml-2 text-xs text-text-muted dark:text-text-muted-dark">
                  {new Date(revision.createdAt).toLocaleString()}
                </span>
              </span>
              <span className="shrink-0 text-xs text-text-muted dark:text-text-muted-dark">
                {revision.nodeCount} nodes · {revision.edgeCount} edges
              </span>
            </Button>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void restore()}
        title="Restore this version"
        message="Replace the workflow with this version? Its current state is kept as a version, so you can restore it again."
        confirmLabel="Restore"
        intent="warning"
      />
    </Modal>
  );
}
