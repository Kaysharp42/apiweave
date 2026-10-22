import { useEffect, useRef, useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { WorkspacePendingChange } from "@shared/types/WorkspacePendingChange";
import type { WorkspacePendingChangeType } from "@shared/types/WorkspacePendingChangeType";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { Spinner } from "../atoms/Spinner";
import { FormField } from "../molecules/FormField";
import { Modal } from "../molecules/Modal";
import { git } from "../../utils/apiweaveClient";
import type { GitCommitDialogProps, PendingChangesList } from "../../types";

const CHANGE_WORDS: Readonly<Record<WorkspacePendingChangeType, string>> = {
  added: "Added",
  changed: "Changed",
  deleted: "Deleted",
};

const CHANGE_ICONS = {
  added: Plus,
  changed: Pencil,
  deleted: Trash2,
} as const;

function ChangeRow({ change }: { readonly change: WorkspacePendingChange }) {
  const Icon = CHANGE_ICONS[change.change];
  return (
    <li className="flex items-center gap-2 text-sm text-text-primary dark:text-text-primary-dark">
      <Icon
        className="h-3.5 w-3.5 flex-shrink-0 text-text-secondary dark:text-text-secondary-dark"
        aria-hidden="true"
      />
      <span className="min-w-0 break-words">
        {CHANGE_WORDS[change.change]} {change.kind} &ldquo;{change.name}&rdquo;
      </span>
    </li>
  );
}

function PendingChanges({ list }: { readonly list: PendingChangesList }) {
  if (list.state === "loading") return <Spinner size="sm" />;
  if (list.state === "failed") {
    return (
      <p role="alert" className="text-xs text-status-error dark:text-[var(--aw-status-error)]">
        Couldn&apos;t list the changes: {list.message}
      </p>
    );
  }
  if (list.changes.length === 0) {
    return (
      <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
        No workflow, project or environment changed since the last commit.
      </p>
    );
  }
  return (
    <ul aria-label="Pending changes" className="max-h-60 space-y-1.5 overflow-y-auto">
      {list.changes.map((change) => (
        <ChangeRow key={`${change.kind}:${change.path}`} change={change} />
      ))}
    </ul>
  );
}

/**
 * Manual mode's commit step: what the next commit would add, change and
 * delete — by the records' names, not file paths — and an optional message.
 * Left empty, the commit describes the files it changed.
 *
 * Mounted only while it is wanted, so every opening starts from a fresh list
 * and an empty message, with no state to reset when a prop flips.
 */
export function GitCommitDialog({
  workspaceId,
  connected,
  onClose,
  onConfirm,
}: GitCommitDialogProps) {
  const [list, setList] = useState<PendingChangesList>({ state: "loading" });
  const [message, setMessage] = useState("");
  const messageRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    git
      .pendingChanges(workspaceId)
      .then((changes) => {
        if (!cancelled) setList({ state: "ready", changes });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setList({
          state: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (list.state !== "loading") onConfirm(message);
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={connected ? "Commit and sync changes" : "Commit changes"}
      size="sm"
      initialFocus={messageRef}
      footer={() => (
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="git-commit-form"
            disabled={list.state === "loading"}
          >
            {connected ? "Commit and sync" : "Commit"}
          </Button>
        </>
      )}
    >
      <form id="git-commit-form" onSubmit={handleSubmit} className="space-y-4 p-5">
        <PendingChanges list={list} />
        <FormField
          label="Commit message"
          hint="Optional — left empty, the commit names the files it changed."
        >
          <Input
            ref={messageRef}
            aria-label="Commit message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Describe this change"
            autoComplete="off"
          />
        </FormField>
      </form>
    </Modal>
  );
}
