/**
 * Credential heuristics shared by the main process (exports, imports, sync)
 * and the renderer (environment variable import): whether a key NAME says it
 * holds a secret, and whether a string VALUE carries credential material.
 */

/**
 * Key-name patterns deciding whether a dict key *holds* a secret. Ported verbatim
 * from Python `SECRET_KEY_PATTERNS` — the set of keys redacted must match so an
 * exported bundle sanitizes identically across stacks. Scoped to key names (not
 * values) to avoid over-redacting non-secret data like request-token ids.
 */
const SECRET_KEY_PATTERNS: readonly RegExp[] = [
  /^api[_-]?key$/i,
  /^secret$/i,
  /^token$/i,
  /^password$/i,
  /^authorization$/i,
  /^auth[_-]/i,
  /[_-]?api[_-]?key$/i,
  /[_-]?secret$/i,
  /[_-]?token$/i,
  /[_-]?password$/i,
  /^access[_-]?token$/i,
  /^refresh[_-]?token$/i,
  /^private[_-]?key$/i,
  /^client[_-]?secret$/i,
  /[_-]key$/i,
  /[_-]auth$/i,
  /[_-]credential[s]?$/i,
  /[_-]private[_-]key$/i,
  /[_-]client[_-]secret$/i,
]

/** True if a dict key name suggests it holds a secret value. */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key))
}

// Credential shapes that must never leave the machine. Deliberately narrow:
// request bodies and header values are workflow config, and a broad heuristic
// (anything containing "token") empties the config it is meant to protect.
const BEARER_CREDENTIAL_PATTERN = /\bbearer\s+[a-zA-Z0-9_.-]*[0-9_.-][a-zA-Z0-9_.-]*/i
const JWT_CREDENTIAL_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/
const STRIPE_LIVE_KEY_PATTERN = /\b(?:sk|pk)_live_[A-Za-z0-9_-]+\b/i
/** A `{{...}}` reference span. */
export const REF_SPAN_RE = /\{\{[^{}]*\}\}/g

/**
 * True if a string carries credential material once its `{{...}}` references
 * are removed. Stripping first is what makes `Authorization: Bearer
 * {{secrets.TOKEN}}` a keeper while `{{env.SCHEME}} eyJhbGci...` is not: a
 * value is not laundered by having a reference somewhere else in it.
 */
export function containsCredentialMaterial(value: string): boolean {
  const literal = value.replace(REF_SPAN_RE, "")
  return BEARER_CREDENTIAL_PATTERN.test(literal)
    || JWT_CREDENTIAL_PATTERN.test(literal)
    || STRIPE_LIVE_KEY_PATTERN.test(literal)
}
