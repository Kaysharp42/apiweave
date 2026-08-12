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
 * Which consumer a sanitizer pass is serving. Both withhold every credential
 * value; they differ in what they do to the surrounding structure.
 *
 * - `export` — an `.awecollection` bundle or sync payload leaving the machine.
 *   Fail closed and drop, so nothing downstream can mistake a placeholder for a
 *   working credential.
 * - `agent-read` — a read crossing the local MCP bridge. Keep the shape intact
 *   (redacted values in place, not missing keys) so an agent can diff what it
 *   wrote against what was stored.
 */
export type SanitizeMode = "export" | "agent-read"

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

/**
 * Any `{{...}}` placeholder a runtime interpolates against `env`/`variables`/
 * `prev`/`secrets` — a reference, not a literal. Round-trip redaction by value
 * (not key name) keys off this: a value that is one of these references holds
 * no secret and must survive a read verbatim, so `workflows_get` →
 * `workflows_update` does not silently clobber `bearer.token: "{{variables.token}}"`,
 * `extractors.token: "response.body.token"`, or `body.password: "{{env.PASSWORD}}"`
 * with the `<SECRET>` literal. `{{funcName(...)}}` is intentionally out of scope: a function call only ever
 * yields a literal value, never the credential shape itself, and including it
 * risked false-positive preservation of opaque strings that happen to wrap in
 * braces.
 */
// Case-sensitive to match `substituteVariables`, which resolves `varPath.startsWith("env.")`
// etc. literally — `{{ENV.PASSWORD}}` is not a reference to the runtime, so redaction must
// not treat it as one either.
const INDIR_REF_RE = /\{\{\s*(?:env\.|variables\.|prev\b|secrets\.)/

function containsIndirectionRef(value: string): boolean {
  return INDIR_REF_RE.test(value)
}

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
 * redaction unnoticed. In `agent-read` mode a leaf that is an `{{env.*}}` /
 * `{{variables.*}}` / `{{prev...}}` / `{{secrets.*}}` reference survives: an
 * agent's read-modify-write has to be able to tell "this slot is wired to a
 * reference" from "this slot holds a literal I must not clobber", or every
 * round trip overwrites the credential indirection with `<SECRET>`.
 */
function sanitizeAuthConfigForExport(auth: Record<string, JsonValue>, mode: SanitizeMode): Record<string, JsonValue> {
  const sanitized: Record<string, JsonValue> = { ...auth }
  const { bearer, basic, apiKey } = sanitized
  const leaf = (value: string): JsonValue => (keepAsReference(value, mode) ? value : SECRET_PLACEHOLDER)
  if (isRecord(bearer) && typeof bearer["token"] === "string") {
    sanitized["bearer"] = { ...bearer, token: leaf(bearer["token"]) }
  }
  if (isRecord(basic) && typeof basic["password"] === "string") {
    sanitized["basic"] = { ...basic, password: leaf(basic["password"]) }
  }
  if (isRecord(apiKey) && typeof apiKey["value"] === "string") {
    sanitized["apiKey"] = { ...apiKey, value: leaf(apiKey["value"]) }
  }
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
 *
 * `export` drops entries whose key names a secret entirely, so an imported
 * bundle forces the operator to re-enter the credential rather than sending a
 * placeholder upstream; `redactAllValues` additionally blanks every remaining
 * value regardless of key name (used for cookies, which routinely carry session
 * material under non-secret-looking names).
 *
 * `agent-read` never drops an entry. An agent reading back what it just wrote
 * has to be able to tell "the header is stored, its value is withheld" from
 * "the header was silently discarded" — dropping makes a read useless as a
 * write confirmation, and the value is redacted either way.
 */
function sanitizeKeyValueArray(items: readonly JsonValue[], redactAllValues: boolean, mode: SanitizeMode): JsonValue[] {
  const sanitized: JsonValue[] = []
  for (const item of items) {
    const entry = sanitizeKeyValueEntry(item, redactAllValues, mode)
    if (entry !== undefined) sanitized.push(entry)
  }
  return sanitized
}

/** One `{key, value}` entry, or `undefined` when export mode drops it entirely. */
function sanitizeKeyValueEntry(
  item: JsonValue,
  redactAllValues: boolean,
  mode: SanitizeMode,
): JsonValue | undefined {
  if (!isRecord(item)) return item
  const key = item["key"]
  const secretKey = typeof key === "string" && isSecretKey(key)
  if (secretKey && mode === "export") return undefined
  const value = item["value"]
  if (typeof value !== "string") return item
  return withholdsPairValue(value, secretKey, redactAllValues)
    ? { ...item, value: SECRET_PLACEHOLDER }
    : item
}

/**
 * Whether a `{key, value}` pair's value must be withheld.
 *
 * `redactAllValues` (cookies) withholds unconditionally — session material hides
 * under names that look harmless. Otherwise only a secret-named key withholds,
 * and even then a `{{...}}` indirection reference in any namespace (env,
 * variables, prev, secrets) survives: it is a reference, not the secret, and
 * seeing it is how an agent knows which slot a credential binds to.
 */
function withholdsPairValue(value: string, secretKey: boolean, redactAllValues: boolean): boolean {
  if (redactAllValues) return true
  if (containsIndirectionRef(value)) return false
  return secretKey
}

/**
 * Redact an HTTP request body for an agent read. A body is workflow *config*,
 * not run evidence: blanket-replacing it with `<SECRET>` tells the agent nothing
 * about whether its write landed, and — because `<SECRET>` is a valid string for
 * `HTTPNodeDataSchema.body` — poisons any read/modify/write round trip.
 *
 * So redact structurally instead: parse the body as JSON and blank only the
 * leaves whose key names a secret or whose value looks like a credential,
 * keeping `{{...}}` references in any namespace (env, variables, prev, secrets)
 * intact. A body that isn't JSON gets the value-level heuristic applied to the
 * whole string. When nothing needed redacting the original string is returned
 * verbatim, so re-formatting never shows up as a spurious diff.
 */
function sanitizeBodyForAgentRead(body: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return looksLikeSecretValue(body) && !containsIndirectionRef(body) ? SECRET_PLACEHOLDER : body
  }
  let redacted = false
  const walk = (value: unknown, keyName: string | null): unknown => {
    if (Array.isArray(value)) return value.map((item) => walk(item, keyName))
    if (isRecord(value)) {
      const out: Record<string, JsonValue> = {}
      for (const [key, child] of Object.entries(value)) out[key] = walk(child, key) as JsonValue
      return out
    }
    if (typeof value !== "string") return value
    if (containsIndirectionRef(value)) return value
    if ((keyName !== null && isSecretKey(keyName)) || looksLikeSecretValue(value)) {
      redacted = true
      return SECRET_PLACEHOLDER
    }
    return value
  }
  const sanitized = walk(parsed, null)
  return redacted ? JSON.stringify(sanitized, null, 2) : body
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
  return sanitizeValue(data, "export")
}

/**
 * The read sanitizer for the MCP bridge. Same secret-safety floor as
 * {@link sanitizeExportValue} — no credential value ever crosses the wire — but
 * structure-preserving, because an agent's only way to confirm a write landed is
 * to read it back. Where the export mode drops a secret-named header entry and
 * flattens every body to `<SECRET>`, this mode keeps the entry with a redacted
 * value and redacts bodies leaf-by-leaf. See {@link sanitizeKeyValueArray} and
 * {@link sanitizeBodyForAgentRead}.
 */
export function sanitizeAgentReadValue(data: JsonValue): JsonValue {
  return sanitizeValue(data, "agent-read")
}

/**
 * Per-field rules, keyed by the field name they claim. A rule returns
 * `undefined` for "not my shape" so the caller falls through to the generic
 * walk — table lookup rather than an if/else ladder, so adding a structural
 * field is one entry instead of another branch.
 */
const FIELD_SANITIZERS: Readonly<Record<string, (value: JsonValue, mode: SanitizeMode) => JsonValue | undefined>> = {
  auth: (value, mode) => (isRecord(value) ? sanitizeAuthConfigForExport(value, mode) : undefined),
  fileUploads: (value) => (Array.isArray(value) ? sanitizeFileUploadsForExport(value) : undefined),
  cookies: (value, mode) => (Array.isArray(value) ? sanitizeKeyValueArray(value, true, mode) : undefined),
  // Extractor values are response paths ("response.body.data.access_token") by
  // schema definition — never credentials — and the `token`-ish variable names
  // they map from would otherwise be redacted by the key-name heuristic below.
  extractors: (value) => (isRecord(value) ? { ...value } : undefined),
  url: (value) => (typeof value === "string" ? sanitizeUrlForExport(value) : undefined),
  body: (value, mode) => {
    if (typeof value !== "string" || value.trim().length === 0) return undefined
    return mode === "export" ? SECRET_PLACEHOLDER : sanitizeBodyForAgentRead(value)
  },
}

/** The redacted form of one field, or `undefined` when no structural rule applies. */
function sanitizeField(key: string, value: JsonValue, mode: SanitizeMode): JsonValue | undefined {
  const byName = FIELD_SANITIZERS[key]?.(value, mode)
  if (byName !== undefined) return byName
  if (KEY_VALUE_EXPORT_FIELDS.has(key) && Array.isArray(value)) {
    return sanitizeKeyValueArray(value, false, mode)
  }
  if (typeof value === "string" && isSecretKey(key)) {
    return keepAsReference(value, mode) ? value : SECRET_PLACEHOLDER
  }
  return undefined
}

/**
 * An agent read keeps a `{{...}}` indirection reference — in any namespace
 * (env, variables, prev, secrets) — verbatim: it is a reference, not the secret.
 */
function keepAsReference(value: string, mode: SanitizeMode): boolean {
  return mode === "agent-read" && containsIndirectionRef(value)
}

function sanitizeValue(data: JsonValue, mode: SanitizeMode): JsonValue {
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeValue(item, mode))
  }
  if (!isRecord(data)) {
    return data
  }
  const sanitized: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(data)) {
    sanitized[key] = sanitizeField(key, value, mode) ?? sanitizeValue(value, mode)
  }
  return sanitized
}

/**
 * Find where a caller is writing back a value it read through a redacting
 * surface. `<SECRET>` is never a legitimate stored value — it is what a read
 * substituted for one — so persisting it silently replaces a working credential
 * with a literal that will be sent upstream verbatim on the next run.
 *
 * Returns the dotted paths of every offending leaf (empty when clean) so the
 * caller can name them instead of failing with "invalid input".
 */
export function findRedactedPlaceholders(data: JsonValue, basePath = ""): string[] {
  if (typeof data === "string") {
    return data.includes(SECRET_PLACEHOLDER) ? [basePath === "" ? "(root)" : basePath] : []
  }
  if (Array.isArray(data)) {
    return data.flatMap((item, index) => findRedactedPlaceholders(item, `${basePath}[${index}]`))
  }
  if (isRecord(data)) {
    return Object.entries(data).flatMap(([key, value]) =>
      findRedactedPlaceholders(value, basePath === "" ? key : `${basePath}.${key}`),
    )
  }
  return []
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
