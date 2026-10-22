import type { JsonValue } from "../types/JsonValue"

/** Structural fields that must NEVER appear in an export bundle or a repository file — fail closed if seen. */
const FORBIDDEN_EXPORT_KEYS: ReadonlySet<string> = new Set([
  "ciphertext",
  "privateKey",
  "private_key",
  "plaintext",
  "secretValue",
  "secret_value",
  "encryptedValue",
  "encrypted_value",
  "kek_id",
  "kek",
  "dek",
  "wrapped_dek",
  "hmacSecret",
  "hmac_secret",
])

/**
 * True for a key that names actual secret *storage* (`ciphertext`, `kek`, the
 * vault fields) rather than a user credential slot (`token`, `password`).
 * Sanitizers drop these keys outright: a blanked vault field is still a vault
 * field, and keeping one would trip {@link assertNoSecretValues}. Never confuse
 * this with a workflow's own `password`/`token` config, whose slot must survive
 * so `{{variables.password}}` references do not dangle.
 */
export function isForbiddenSecretStorageKey(key: string): boolean {
  return FORBIDDEN_EXPORT_KEYS.has(key)
}

/**
 * Fail-closed guard: throw if any forbidden secret-storage key is present anywhere
 * in the structure. A leak here is a programming error, not user input, so it must
 * fail loudly before the bundle ever leaves the process (Python `_check_no_secret_values`).
 */
export function assertNoSecretValues(data: JsonValue, path = ""): void {
  if (Array.isArray(data)) {
    data.forEach((item, index) => assertNoSecretValues(item, `${path}[${index}]`))
  } else if (typeof data === "object" && data !== null) {
    for (const key of Object.keys(data)) {
      if (FORBIDDEN_EXPORT_KEYS.has(key)) {
        throw new Error(
          `Bundle contains forbidden secret field '${key}' at '${path || "(root)"}'. ` +
            "Schema v2 bundles must never contain secret values or ciphertext.",
        )
      }
    }
    for (const [key, value] of Object.entries(data)) {
      assertNoSecretValues(value, path ? `${path}.${key}` : key)
    }
  }
}
