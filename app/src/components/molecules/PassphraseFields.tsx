import { type Ref } from "react";
import { ShieldAlert } from "lucide-react";
import { MIN_PASSPHRASE_LENGTH } from "@shared/passphrase";
import { Input } from "../atoms/Input";
import type { PassphraseDraft } from "../../types/PassphraseDraft";

/**
 * The fields for choosing a NEW workspace passphrase: the passphrase, its
 * confirmation, the strength read-out, the blunt loss warning, and the typed
 * acknowledgement that gates the submit.
 *
 * Shared by the Cloud Sync passphrase dialog and the create-workspace form,
 * because both commit the user permanently and the warning must not drift
 * between them. Holds no state: nothing here should outlive the form.
 */

interface PassphraseFieldsProps {
  /** Typed verbatim by the user to confirm. Also names the workspace at risk. */
  readonly workspaceName: string;
  readonly value: PassphraseDraft;
  readonly onChange: (next: PassphraseDraft) => void;
  readonly passphraseLabel?: string;
  readonly disabled?: boolean;
  readonly passphraseRef?: Ref<HTMLInputElement>;
}

/** A cleared form. Callers reset to this when their dialog opens or closes. */
export const EMPTY_PASSPHRASE_DRAFT: PassphraseDraft = {
  passphrase: "",
  confirmPassphrase: "",
  acknowledgement: "",
};

/**
 * ponytail: length-and-variety only. It cannot tell "Password1234!" from a real
 * passphrase, and knows nothing about dictionaries, keyboard walks or breach
 * lists — it rewards length above all, because that is the one signal this
 * heuristic reads correctly. Upgrade path: a real estimator (zxcvbn) or a
 * breach-list lookup, if this ever has to gate rather than inform.
 */
export function passphraseStrength(value: string): {
  readonly score: 0 | 1 | 2 | 3;
  readonly label: string;
} {
  if (value.length < MIN_PASSPHRASE_LENGTH) {
    return {
      score: 0,
      label: `Too short — use at least ${MIN_PASSPHRASE_LENGTH} characters`,
    };
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) =>
    re.test(value),
  ).length;
  if (value.length >= 24 || (value.length >= 16 && classes >= 3)) {
    return { score: 3, label: "Strong" };
  }
  if (value.length >= 16 || classes >= 3) {
    return { score: 2, label: "Reasonable" };
  }
  return { score: 1, label: "Weak — add length or a few more character types" };
}

/**
 * Whether the fields are complete enough to submit. The typed acknowledgement
 * is part of the gate, not a nicety — see the label for why it is typed rather
 * than checked.
 */
export function passphraseFieldsReady(
  value: PassphraseDraft,
  workspaceName: string,
): boolean {
  return (
    workspaceName.trim().length > 0 &&
    passphraseStrength(value.passphrase).score > 0 &&
    value.confirmPassphrase === value.passphrase &&
    value.acknowledgement.trim() === workspaceName.trim()
  );
}

export function PassphraseFields({
  workspaceName,
  value,
  onChange,
  passphraseLabel = "Passphrase",
  disabled = false,
  passphraseRef,
}: PassphraseFieldsProps) {
  const { passphrase, confirmPassphrase, acknowledgement } = value;
  const strength = passphraseStrength(passphrase);
  const mismatch =
    confirmPassphrase.length > 0 && confirmPassphrase !== passphrase;

  return (
    <>
      <div className="flex items-start gap-2 rounded-sm border border-status-error/30 bg-status-error/5 p-3 dark:border-[var(--aw-status-error)]/30 dark:bg-[var(--aw-status-error)]/10">
        <ShieldAlert
          className="mt-0.5 h-4 w-4 shrink-0 text-status-error dark:text-[var(--aw-status-error)]"
          aria-hidden="true"
        />
        <div className="space-y-1 text-xs text-text-secondary dark:text-text-secondary-dark">
          <p className="font-semibold text-status-error dark:text-[var(--aw-status-error)]">
            If you lose this passphrase, this workspace&rsquo;s data is gone.
          </p>
          <p>
            There is no reset, no recovery code, and no support path. Nobody at
            APIWeave can read it back for you, because nobody at APIWeave ever
            has it. Write it down somewhere you will still have it in a year.
          </p>
        </div>
      </div>

      <Input
        ref={passphraseRef}
        type="password"
        label={passphraseLabel}
        autoComplete="new-password"
        value={passphrase}
        onChange={(event) =>
          onChange({ ...value, passphrase: event.target.value })
        }
        spellCheck={false}
        disabled={disabled}
      />

      {/* Announced politely so the meter is not silent to a screen reader, and
          not re-read on every keystroke of a long passphrase. */}
      <p
        aria-live="polite"
        className="-mt-2 text-xs text-text-muted dark:text-text-muted-dark"
      >
        {passphrase.length === 0 ? (
          `Use at least ${MIN_PASSPHRASE_LENGTH} characters. Length beats punctuation.`
        ) : (
          <>
            <span aria-hidden="true" className="mr-1 font-mono">
              {"▮".repeat(strength.score)}
              {"▯".repeat(3 - strength.score)}
            </span>
            Passphrase strength: {strength.label}
          </>
        )}
      </p>

      <Input
        type="password"
        label="Confirm passphrase"
        autoComplete="new-password"
        value={confirmPassphrase}
        onChange={(event) =>
          onChange({ ...value, confirmPassphrase: event.target.value })
        }
        spellCheck={false}
        disabled={disabled}
        {...(mismatch ? { error: "The two passphrases don't match." } : {})}
      />

      {/* A typed workspace name, not a checkbox: a checkbox sits beside the
          confirm button and is satisfied by the same click-through motion, and
          Enter from the passphrase field would sail straight past it. Typing
          the name cannot be done without reading it, and proves the user knows
          WHICH workspace they are committing forever. */}
      <Input
        label={`Type “${workspaceName}” to confirm you have saved this passphrase`}
        autoComplete="off"
        value={acknowledgement}
        onChange={(event) =>
          onChange({ ...value, acknowledgement: event.target.value })
        }
        spellCheck={false}
        disabled={disabled}
        helperText="Deliberate on purpose. This cannot be undone."
      />
    </>
  );
}
