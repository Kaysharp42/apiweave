/**
 * The floor for a NEW workspace passphrase.
 *
 * Lives in `shared/` because both sides of the IPC seam need the same number
 * and neither may import the other: the renderer reads it to give strength
 * feedback before submit, and the IPC handler enforces it, because the handler
 * is the actual trust boundary — a renderer-only floor is advice, not a rule.
 *
 * Never applied when UNLOCKING: that verifies a passphrase a workspace already
 * has, and a floor there would lock a workspace out rather than protect it.
 */
export const MIN_PASSPHRASE_LENGTH = 12
