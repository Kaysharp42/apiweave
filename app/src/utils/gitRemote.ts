/** A remote over HTTPS, the only kind a `gh`/`glab` account is bound to (Phase 3's rule). */
export const HTTPS_REMOTE = /^https:\/\//i;

/** A message from whatever a call threw: an error's own, or the value's text. */
export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
