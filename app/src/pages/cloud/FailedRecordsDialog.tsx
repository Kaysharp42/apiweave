import { AlertTriangle, Loader2 } from "lucide-react";
import { Modal } from "../../components/molecules/Modal";
import { Button } from "../../components/atoms/Button";
import type { CloudFailedRecord } from "../../types/cloud";

// The outbox stores the wire kind; the UI shows what the user calls it.
const KIND_LABELS: Record<string, string> = {
  workspace: "Workspace",
  project: "Collection",
  collection: "Collection",
  workflow: "Workflow",
  environment: "Environment",
};

const OP_LABELS: Record<string, string> = {
  upsert: "Save",
  tombstone: "Delete",
};

function formatQueuedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

interface FailedRecordsDialogProps {
  readonly open: boolean;
  readonly workspaceName: string;
  readonly records: readonly CloudFailedRecord[] | null;
  readonly error: string | null;
  readonly onClose: () => void;
}

/**
 * Names the records behind a workspace's "N failed" count. Without this the
 * user is told a change can't sync but not which one, and has to open every
 * workflow to guess.
 */
export function FailedRecordsDialog({
  open,
  workspaceName,
  records,
  error,
  onClose,
}: FailedRecordsDialogProps) {
  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={`Changes that couldn't sync — ${workspaceName}`}
      size="md"
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="px-5 py-4">
        {error ? (
          <div className="flex items-start gap-2 text-xs text-status-error dark:text-status-error-dark">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : records === null ? (
          <div className="flex items-center gap-2 text-xs text-text-muted dark:text-text-muted-dark">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading…</span>
          </div>
        ) : records.length === 0 ? (
          <p className="text-xs text-text-muted dark:text-text-muted-dark">
            Nothing is failing right now.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {records.map((record) => (
              <li
                key={record.outboxId}
                className="rounded-sm border border-border p-3 dark:border-border-dark"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-sm font-medium text-text-primary dark:text-text-primary-dark">
                    {record.recordName ?? "Deleted on this device"}
                  </span>
                  <span className="text-[11px] text-text-muted dark:text-text-muted-dark">
                    {KIND_LABELS[record.kind] ?? record.kind}
                    {" · "}
                    {OP_LABELS[record.op] ?? record.op}
                  </span>
                </div>
                {record.failureReason ? (
                  <p className="mt-1 break-words text-[11px] text-status-error dark:text-status-error-dark">
                    {record.failureReason}
                  </p>
                ) : null}
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-muted dark:text-text-muted-dark">
                  <span>Queued {formatQueuedAt(record.queuedAt)}</span>
                  <span>
                    {record.attempts} attempt{record.attempts === 1 ? "" : "s"}
                  </span>
                  {/* The id is the only handle that survives a rename, and it
                      is what a support log or a DB lookup will be keyed by. */}
                  <span className="font-mono">{record.recordId}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
