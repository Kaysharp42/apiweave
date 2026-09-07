import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type Ref,
} from "react";
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
import type { PassphraseDraft } from "../../types/PassphraseDraft";

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
function detailOf(error: unknown, flag: string): unknown {
  return error instanceof IpcError &&
    typeof error.details === "object" &&
    error.details !== null
    ? (error.details as Record<string, unknown>)[flag]
    : undefined;
}

function hasDetailFlag(error: unknown, flag: string): boolean {
  return detailOf(error, flag) === true;
}

/**
 * `unlockWorkspace` fetches the workspace's wrapped key before it touches the
 * passphrase, so a failure of that fetch is not something a different passphrase
 * fixes. Main tags those with the reason (`encryptionErrors` in
 * core/ipc/handlers/cloud.ts) and the dialog takes the field away rather than
 * asking again for a secret that was never the problem.
 */
const KEY_UNAVAILABLE_REASONS = [
  "signed-out",
  "no-access",
  "unreachable",
  "rejected",
] as const;

type KeyUnavailableReason = (typeof KEY_UNAVAILABLE_REASONS)[number];

function keyUnavailableReason(error: unknown): KeyUnavailableReason | null {
  const reason = detailOf(error, "workspaceKeyUnavailable");
  return KEY_UNAVAILABLE_REASONS.includes(reason as KeyUnavailableReason)
    ? (reason as KeyUnavailableReason)
    : null;
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

/**
 * Only the transient reason gets a retry. Offering one for a revoked
 * membership or a server bug is a button that cannot work. Split out of the
 * dialog so the blocked/normal split isn't a nested ternary in JSX.
 */
function renderDialogFooter({
  blockedBy,
  onClose,
  onRetry,
  submitting,
  canSubmit,
  formId,
  submitLabel,
}: {
  blockedBy: KeyUnavailableReason | null;
  onClose: () => void;
  onRetry: () => void;
  submitting: boolean;
  canSubmit: boolean;
  formId: string;
  submitLabel: string;
}) {
  if (blockedBy !== null) {
    return (
      <>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        {blockedBy === "unreachable" ? (
          <Button onClick={onRetry}>Try again</Button>
        ) : null}
      </>
    );
  }
  return (
    <>
      <Button variant="ghost" onClick={onClose} disabled={submitting}>
        Cancel
      </Button>
      <Button type="submit" form={formId} loading={submitting} disabled={!canSubmit}>
        {submitLabel}
      </Button>
    </>
  );
}

/** `headerExtra`: the lock icon while unlocking, the key icon otherwise. */
function dialogHeaderIcon(mode: EncryptionDialogMode) {
  return mode === "unlock" ? (
    <Lock
      className="h-4 w-4 text-text-secondary dark:text-text-secondary-dark"
      aria-hidden="true"
    />
  ) : (
    <KeyRound
      className="h-4 w-4 text-text-secondary dark:text-text-secondary-dark"
      aria-hidden="true"
    />
  );
}

/**
 * The form's main content: blocked notice, lead copy, error, and the
 * passphrase field(s). Split out so the blocked/lead/field branches read as
 * guard clauses instead of a chain of JSX ternaries.
 */
function renderDialogBody({
  blockedBy,
  copy,
  error,
  isNewPassphrase,
  workspaceName,
  draft,
  setDraft,
  submitting,
  passphraseRef,
}: {
  blockedBy: KeyUnavailableReason | null;
  copy: (typeof DIALOG_COPY)[EncryptionDialogMode];
  error: string | null;
  isNewPassphrase: boolean;
  workspaceName: string;
  draft: PassphraseDraft;
  setDraft: (draft: PassphraseDraft) => void;
  submitting: boolean;
  passphraseRef: Ref<HTMLInputElement>;
}) {
  return (
    <>
      {/* Blocked: the lead promises that entering a passphrase resumes sync,
          which is untrue when the key could not be fetched. Only the alert. */}
      {blockedBy === null && (
        <>
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
        </>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-sm border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error dark:border-[var(--aw-status-error)]/30 dark:text-[var(--aw-status-error)]"
        >
          {error}
        </div>
      )}

      {blockedBy === null &&
        (isNewPassphrase ? (
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
        ))}
    </>
  );
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
  const [blockedBy, setBlockedBy] = useState<KeyUnavailableReason | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The page leaves this dialog mounted between openings; without the reset it
  // would reopen holding the last passphrase typed into it.
  useEffect(() => {
    if (!open) return;
    setDraft(EMPTY_PASSPHRASE_DRAFT);
    setError(null);
    setBlockedBy(null);
    setSubmitting(false);
  }, [open, mode, workspaceName]);

  const isNewPassphrase = mode !== "unlock";
  const canSubmit =
    !submitting &&
    !busy &&
    blockedBy === null &&
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
      const unavailable = keyUnavailableReason(submitError);
      if (unavailable !== null) {
        // The key material never arrived, so the passphrase was never tried.
        // Hide the field: leaving it up under this message is what makes every
        // one of these read as "you typed it wrong".
        setBlockedBy(unavailable);
        setError(submitErrorMessage(submitError));
        setDraft(EMPTY_PASSPHRASE_DRAFT);
      } else if (hasDetailFlag(submitError, "passphraseIncorrect")) {
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
      headerExtra={dialogHeaderIcon(mode)}
      footer={() =>
        renderDialogFooter({
          blockedBy,
          onClose,
          onRetry: () => {
            setBlockedBy(null);
            setError(null);
          },
          submitting,
          canSubmit,
          formId,
          submitLabel: copy.submitLabel,
        })
      }
    >
      <form
        id={formId}
        onSubmit={(event) => void handleSubmit(event)}
        className="space-y-4 p-5"
      >
        {renderDialogBody({
          blockedBy,
          copy,
          error,
          isNewPassphrase,
          workspaceName,
          draft,
          setDraft,
          submitting,
          passphraseRef,
        })}
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
