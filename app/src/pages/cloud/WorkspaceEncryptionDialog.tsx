import { useEffect, useRef, useState, type FormEvent } from "react";
import { KeyRound, Lock } from "lucide-react";
import { Button } from "../../components/atoms/Button";
import { Input } from "../../components/atoms/Input";
import { Modal } from "../../components/molecules/Modal";
import {
  EMPTY_PASSPHRASE_DRAFT,
  PassphraseFields,
  passphraseFieldsReady,
} from "../../components/molecules/PassphraseFields";
import { IpcError } from "../../utils/apiweaveClient";

/**
 * The one passphrase dialog: choosing encryption for a workspace, unlocking a
 * locked one, and changing an unlocked one's passphrase. All three ask for the
 * same secret through the same field, so they are one component rather than
 * three near-copies.
 *
 * The passphrase lives in component state only while the dialog is open and
 * goes straight to main, which stretches it into a key and drops it. Nothing
 * here stores, logs, or re-reads it.
 */

type EncryptionDialogMode = "setup" | "unlock" | "change";

interface WorkspaceEncryptionDialogProps {
  readonly open: boolean;
  readonly mode: EncryptionDialogMode;
  readonly workspaceName: string;
  readonly busy: boolean;
  readonly onClose: () => void;
  /** Rejects on failure; the dialog stays open and renders the reason. */
  readonly onSubmit: (passphrase: string) => Promise<unknown>;
}

/**
 * Main tags every encryption failure the dialog has to tell apart with a detail
 * flag (see `encryptionErrors` in core/ipc/handlers/cloud.ts). Read the flag —
 * never the message: an untagged error arrives with Electron's
 * "Error invoking remote method" prefix wrapped around it.
 */
function hasDetailFlag(error: unknown, flag: string): boolean {
  return (
    error instanceof IpcError &&
    typeof error.details === "object" &&
    error.details !== null &&
    (error.details as Record<string, unknown>)[flag] === true
  );
}

/**
 * `SetWorkspacePassphrase` is admin-only server-side, and re-wrapping needs the
 * current key. Both refusals are tagged, so say what to do about them instead of
 * forwarding the sentence main happened to use.
 */
function submitErrorMessage(error: unknown): string {
  if (hasDetailFlag(error, "passphraseAdminOnly")) {
    return "Only a workspace admin can change this passphrase. Ask an admin to change it, then get the new one from them.";
  }
  if (hasDetailFlag(error, "workspaceLocked")) {
    return "This workspace is locked. Unlock it with its current passphrase first, then change it.";
  }
  return error instanceof Error && error.message
    ? error.message
    : "That didn't work. Try again.";
}

export function WorkspaceEncryptionDialog({
  open,
  mode,
  workspaceName,
  busy,
  onClose,
  onSubmit,
}: WorkspaceEncryptionDialogProps) {
  const passphraseRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(EMPTY_PASSPHRASE_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The page leaves this dialog mounted between openings; without the reset it
  // would reopen holding the last passphrase typed into it.
  useEffect(() => {
    if (!open) return;
    setDraft(EMPTY_PASSPHRASE_DRAFT);
    setError(null);
    setSubmitting(false);
  }, [open, mode, workspaceName]);

  const isNewPassphrase = mode !== "unlock";
  const canSubmit =
    !submitting &&
    !busy &&
    (isNewPassphrase
      ? passphraseFieldsReady(draft, workspaceName)
      : draft.passphrase.length > 0);

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(draft.passphrase);
      onClose();
    } catch (submitError) {
      if (hasDetailFlag(submitError, "passphraseIncorrect")) {
        // Not a sync failure and not a broken workspace: a typo. Clear the
        // field, put focus back in it, and say only that.
        setError(
          "That passphrase doesn't match this workspace. Nothing is wrong with your data or with sync — try again.",
        );
        setDraft(EMPTY_PASSPHRASE_DRAFT);
        passphraseRef.current?.focus();
      } else {
        setError(submitErrorMessage(submitError));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const copy = DIALOG_COPY[mode];
  const formId = "workspace-encryption-form";

  return (
    <Modal
      isOpen={open}
      onClose={submitting ? () => undefined : onClose}
      title={copy.title(workspaceName)}
      size="sm"
      initialFocus={passphraseRef}
      headerExtra={
        mode === "unlock" ? (
          <Lock
            className="h-4 w-4 text-text-secondary dark:text-text-secondary-dark"
            aria-hidden="true"
          />
        ) : (
          <KeyRound
            className="h-4 w-4 text-text-secondary dark:text-text-secondary-dark"
            aria-hidden="true"
          />
        )
      }
      footer={() => (
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            loading={submitting}
            disabled={!canSubmit}
          >
            {copy.submitLabel}
          </Button>
        </>
      )}
    >
      <form
        id={formId}
        onSubmit={(event) => void handleSubmit(event)}
        className="space-y-4 p-5"
      >
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
          {copy.lead}
        </p>

        {copy.notes.map((note) => (
          <p
            key={note}
            className="text-xs text-text-muted dark:text-text-muted-dark"
          >
            {note}
          </p>
        ))}

        {error ? (
          <div
            role="alert"
            className="rounded-sm border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error dark:border-[var(--aw-status-error)]/30 dark:text-[var(--aw-status-error)]"
          >
            {error}
          </div>
        ) : null}

        {isNewPassphrase ? (
          <PassphraseFields
            workspaceName={workspaceName}
            value={draft}
            onChange={setDraft}
            passphraseLabel={copy.passphraseLabel}
            disabled={submitting}
            passphraseRef={passphraseRef}
          />
        ) : (
          <Input
            ref={passphraseRef}
            type="password"
            label={copy.passphraseLabel}
            autoComplete="current-password"
            value={draft.passphrase}
            onChange={(event) =>
              setDraft({ ...draft, passphrase: event.target.value })
            }
            spellCheck={false}
            disabled={submitting}
          />
        )}
      </form>
    </Modal>
  );
}

const DIALOG_COPY: Record<
  EncryptionDialogMode,
  {
    readonly title: (name: string) => string;
    readonly lead: string;
    readonly notes: readonly string[];
    readonly passphraseLabel: string;
    readonly submitLabel: string;
  }
> = {
  setup: {
    title: (name) => `Encrypt “${name}”?`,
    lead: "Everything in this workspace is encrypted on this device before it is uploaded. The cloud stores ciphertext it cannot read, and your passphrase never leaves this device.",
    notes: [
      "This choice is permanent: an encrypted workspace can never be turned back into a plain one, and a plain one can never be encrypted later.",
      "To use this workspace on another device — or to let a teammate use it — you give them this passphrase yourself. APIWeave never sends it anywhere.",
    ],
    passphraseLabel: "Passphrase",
    submitLabel: "Encrypt this workspace",
  },
  unlock: {
    title: (name) => `Unlock “${name}”`,
    lead: "Sync is paused for this workspace until you enter its passphrase. Your local data is untouched and nothing has been lost.",
    notes: [
      "This is the passphrase chosen when the workspace was encrypted. If you don't have it, ask whoever set the workspace up — nobody can reset it.",
    ],
    passphraseLabel: "Passphrase",
    submitLabel: "Unlock",
  },
  change: {
    title: (name) => `Change the passphrase for “${name}”`,
    lead: "This re-wraps the same workspace key under a new passphrase. Nothing is re-encrypted, and nobody loses access to data they already have.",
    notes: [
      "This is not a key rotation. Members who have already unlocked this workspace keep syncing without doing anything.",
      "Anyone who unlocks it again — on a new device, or after locking it — needs the new passphrase. Give it to them yourself; APIWeave never transmits it.",
      "Only a workspace admin can change the passphrase.",
    ],
    passphraseLabel: "New passphrase",
    submitLabel: "Change passphrase",
  },
};
