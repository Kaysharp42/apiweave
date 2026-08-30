/**
 * The three fields of a new-passphrase form — the passphrase, its confirmation,
 * and the typed acknowledgement that gates the submit. Held together so a
 * caller keeps one piece of state and cannot drop the acknowledgement.
 */
export interface PassphraseDraft {
  readonly passphrase: string;
  readonly confirmPassphrase: string;
  readonly acknowledgement: string;
}
