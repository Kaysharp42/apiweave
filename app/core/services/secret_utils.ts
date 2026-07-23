/**
 * Secret detection + export sanitization — ported from the export-relevant subset
 * of `backend/app/services/secret_utils.py` and `project_export_service.py`.
 *
 * Only what export/import needs lives here: key-name secret detection, variable
 * sanitization (`<SECRET>` placeholder), `{{secrets.NAME}}` reference extraction,
 * and the fail-closed forbidden-key guard. Log/structural masking (`SecretMasker`,
 * `mask_secrets_structural`) is an executor concern (Task 14), not this task.
 */

import type { JsonValue } from "@shared/types/JsonValue"

/** Placeholder written in place of a redacted secret value (byte-compat with Python). */
export const SECRET_PLACEHOLDER = "<SECRET>"

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

/**
 * Value-level secret heuristic — ported from Python `SECRET_PATTERNS`. Used by
 * import parsers to decide whether a header value, cookie, or body string looks
 * like it contains a secret and should be replaced with `[FILTERED]`. Intentionally
 * broader than `isSecretKey` (which is key-name-only for export sanitization).
 */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /bearer\s+[a-zA-Z0-9_\-\.]+/i,
  /api[_-]?key/i,
  /secret/i,
  /token/i,
  /password/i,
  /sk_live_/i,
  /pk_live_/i,
]

/** True if a string value heuristically contains a secret (for import sanitization). */
export function detectSecretsInValue(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))
}

const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/

/** Value-level secret heuristic used by export sanitizers: import patterns plus a bare-JWT check. */
export function looksLikeSecretValue(value: string): boolean {
  return detectSecretsInValue(value) || JWT_PATTERN.test(value)
}

/** Structural fields that must NEVER appear in an export bundle — fail closed if seen. */
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

const SECRET_REF_RE = /\{\{secrets\.([A-Za-z_][A-Za-z0-9_]*)\}\}/g

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Extract secret names from `{{secrets.NAME}}` placeholders in a string. */
export function extractSecretRefsFromString(value: string): string[] {
  const names: string[] = []
  for (const match of value.matchAll(SECRET_REF_RE)) {
    if (match[1] !== undefined) names.push(match[1])
  }
  return names
}

/**
 * Recursively replace values whose *key* matches a secret pattern with the
 * `<SECRET>` placeholder. Also inspects string values under innocuous keys
 * (e.g. a JWT or tokenized URL under `BASE_URL`) so manual exports redact the
 * same secret-looking values the cloud-sync sanitizer does, and strips
 * credentials/query-string secrets from URL-shaped strings.
 */
export function sanitizeVariablesForExport(data: Record<string, JsonValue>): Record<string, JsonValue> {
  const sanitized: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(data)) {
    if (isRecord(value)) {
      sanitized[key] = sanitizeVariablesForExport(value)
    } else if (typeof value === "string" && isSecretKey(key)) {
      sanitized[key] = SECRET_PLACEHOLDER
    } else if (typeof value === "string" && extractSecretRefsFromString(value).length > 0) {
      // A `{{secrets.NAME}}` placeholder is a safe indirection, not the secret
      // itself — collectSecretRefs tracks it separately, so it must survive
      // export verbatim (and not get flagged by the "contains 'secret'" value
      // heuristic below).
      sanitized[key] = value
    } else if (typeof value === "string" && /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
      // URL-shaped: strip embedded credentials/fragment surgically rather than
      // nuking the whole value — a URL commonly contains "token"-ish substrings
      // (e.g. an `access_token` fragment key) that aren't the full secret.
      sanitized[key] = sanitizeUrlForExport(value)
    } else if (typeof value === "string" && looksLikeSecretValue(value)) {
      sanitized[key] = SECRET_PLACEHOLDER
    } else {
      sanitized[key] = value
    }
  }
  return sanitized
}

const KEY_VALUE_EXPORT_FIELDS: ReadonlySet<string> = new Set([
  "headers",
  "queryParams",
  "pathVariables",
  "formDataEntries",
  "urlEncodedEntries",
])

/**
 * Redact an HTTP auth config's secret leaf (`bearer.token`, `basic.password`,
 * `apiKey.value`) by field path rather than by key-name heuristic — those leaves
 * are named generically (`value`, `token`) and would otherwise pass key-based
 * redaction unnoticed.
 */
function sanitizeAuthConfigForExport(auth: Record<string, JsonValue>): Record<string, JsonValue> {
  const sanitized: Record<string, JsonValue> = { ...auth }
  const { bearer, basic, apiKey } = sanitized
  if (isRecord(bearer)) sanitized["bearer"] = { ...bearer, token: SECRET_PLACEHOLDER }
  if (isRecord(basic)) sanitized["basic"] = { ...basic, password: SECRET_PLACEHOLDER }
  if (isRecord(apiKey)) sanitized["apiKey"] = { ...apiKey, value: SECRET_PLACEHOLDER }
  return sanitized
}

/**
 * Redact `FileUpload.value` (the base64 payload or local filesystem path) from
 * an export/sync bundle, keeping name/type/fieldName/mimeType/description so
 * the attachment slot round-trips. A `variable` reference just names a
 * workflow variable, not file content, so it passes through unredacted.
 */
function sanitizeFileUploadsForExport(items: readonly JsonValue[]): JsonValue[] {
  return items.map((item) => {
    if (!isRecord(item)) return item
    if (item["type"] === "variable") return item
    return { ...item, value: SECRET_PLACEHOLDER }
  })
}

/**
 * Redact a `{key, value}` pair array (HTTP headers/cookies/query params/etc.).
 * Entries whose key names a secret are dropped entirely; `redactAllValues`
 * additionally blanks every value regardless of key name (used for cookies,
 * which routinely carry session material under non-secret-looking names).
 */
function sanitizeKeyValueArrayForExport(items: readonly JsonValue[], redactAllValues: boolean): JsonValue[] {
  const sanitized: JsonValue[] = []
  for (const item of items) {
    if (!isRecord(item)) {
      sanitized.push(item)
      continue
    }
    const key = item["key"]
    if (typeof key === "string" && isSecretKey(key)) continue
    const value = item["value"]
    sanitized.push(
      typeof value === "string" && redactAllValues
        ? { ...item, value: SECRET_PLACEHOLDER }
        : item,
    )
  }
  return sanitized
}

/**
 * Strip credentials and tokens embedded in a URL: userinfo, secret-looking query
 * params, and the fragment (OAuth implicit-flow tokens live in `#access_token=`).
 */
function sanitizeUrlForExport(value: string): string {
  try {
    const url = new URL(value)
    const hasSecretQueryParam = [...url.searchParams.keys()].some(isSecretKey)
    // Nothing to redact — return the original string verbatim so a plain
    // env-var URL isn't silently reformatted (e.g. a bare origin gaining a
    // trailing slash) by round-tripping it through the URL constructor.
    if (!url.username && !url.password && !url.hash && !hasSecretQueryParam) return value
    url.username = ""
    url.password = ""
    for (const [key] of url.searchParams) {
      if (isSecretKey(key)) url.searchParams.set(key, SECRET_PLACEHOLDER)
    }
    if (url.hash) url.hash = ""
    return url.toString()
  } catch {
    return value
  }
}

/**
 * Deep export/read sanitizer for arbitrary workflow-shaped JSON (node configs,
 * `nodeTemplates`, full workflow/project payloads). Unlike {@link sanitizeVariablesForExport}
 * (key-name-only, one level of dict recursion), this also recurses arrays and
 * understands the concrete HTTP config shape — `{key,value}` pair arrays, `auth`
 * sub-objects, `url`, and `body` — so credentials stored in those structural
 * positions are redacted even when the leaf key name itself (`value`, `token`)
 * doesn't look secret out of context.
 */
export function sanitizeExportValue(data: JsonValue): JsonValue {
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeExportValue(item))
  }
  if (!isRecord(data)) {
    return data
  }
  const sanitized: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(data)) {
    if (key === "auth" && isRecord(value)) {
      sanitized[key] = sanitizeAuthConfigForExport(value)
    } else if (key === "fileUploads" && Array.isArray(value)) {
      sanitized[key] = sanitizeFileUploadsForExport(value)
    } else if (key === "cookies" && Array.isArray(value)) {
      sanitized[key] = sanitizeKeyValueArrayForExport(value, true)
    } else if (KEY_VALUE_EXPORT_FIELDS.has(key) && Array.isArray(value)) {
      sanitized[key] = sanitizeKeyValueArrayForExport(value, false)
    } else if (key === "body" && typeof value === "string" && value.trim().length > 0) {
      sanitized[key] = SECRET_PLACEHOLDER
    } else if (key === "url" && typeof value === "string") {
      sanitized[key] = sanitizeUrlForExport(value)
    } else if (typeof value === "string" && isSecretKey(key)) {
      sanitized[key] = SECRET_PLACEHOLDER
    } else {
      sanitized[key] = sanitizeExportValue(value)
    }
  }
  return sanitized
}

/** A secret reference recorded in an export bundle (name + which scope owns it). */
export interface SecretReference {
  readonly name: string
  readonly scopeType: string
  readonly scopeId: string
}

/**
 * Walk a JSON-like structure collecting every `{{secrets.NAME}}` reference into
 * `into`, deduped by (name, scopeType, scopeId) via `seen`. Covers Python's
 * `_collect_refs` + `_collect_refs_from_config` (dicts, lists, nested strings).
 */
export function collectSecretRefs(
  data: JsonValue,
  scopeType: string,
  scopeId: string,
  into: SecretReference[],
  seen: Set<string>,
): void {
  if (typeof data === "string") {
    for (const name of extractSecretRefsFromString(data)) {
      const dedupeKey = `${name} ${scopeType} ${scopeId}`
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey)
        into.push({ name, scopeType, scopeId })
      }
    }
  } else if (Array.isArray(data)) {
    for (const item of data) collectSecretRefs(item, scopeType, scopeId, into, seen)
  } else if (isRecord(data)) {
    for (const value of Object.values(data)) collectSecretRefs(value, scopeType, scopeId, into, seen)
  }
}

/**
 * Fail-closed guard: throw if any forbidden secret-storage key is present anywhere
 * in the structure. A leak here is a programming error, not user input, so it must
 * fail loudly before the bundle ever leaves the process (Python `_check_no_secret_values`).
 */
export function assertNoSecretValues(data: JsonValue, path = ""): void {
  if (Array.isArray(data)) {
    data.forEach((item, index) => assertNoSecretValues(item, `${path}[${index}]`))
  } else if (isRecord(data)) {
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
