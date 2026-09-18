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
 * Walk a record's own entries, dropping any whose key names secret *storage*
 * ({@link isForbiddenSecretStorageKey}) and transforming the rest. Every
 * redaction pass that recurses into records (export, push-sync, snapshot,
 * agent-read) shares this shape so a vault field can't survive one walk by
 * accident of a hand-rolled loop.
 */
export function mapForbiddenKeyFilteredEntries<V, T>(
  entries: Record<string, V>,
  transform: (key: string, value: V) => T,
): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [key, value] of Object.entries(entries)) {
    if (isForbiddenSecretStorageKey(key)) {
      continue
    }
    out[key] = transform(key, value)
  }
  return out
}

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

/* ------------------------------------------------------------------------- *
 * Cloud-sync redaction contract
 *
 * Three components decide what may cross the wire, and they must agree
 * exactly or a workflow breaks in one of two ways: the push sanitizer emits
 * something a validator rejects (the record dead-letters after 10 retries and
 * every later edit to it is blocked behind it), or a validator rejects
 * something the sanitizer kept (the receiving device throws mid-pull, never
 * advances its cursor, and stops syncing that workspace entirely).
 *
 *   1. push sanitizer   `core/sync/cloud-mutations.ts`
 *   2. pull validator   `core/repositories/CloudSyncRepository.ts`
 *   3. server validator `apps/api/internal/sync/workflow_service.go`
 *      (apiweave-cloud — a hand-mirrored copy of the three predicates below;
 *      change both sides together, and mirror the fixture table in
 *      `core/sync/__tests__/sync-redaction-contract.test.ts`)
 *
 * The contract, stated once:
 *
 *   - Under a sync-sensitive key name, the only non-empty SCALAR allowed is a
 *     credential-free indirection reference. The sanitizer blanks everything
 *     else in place, keeping the key so the receiving machine still shows the
 *     operator which slot to fill.
 *   - A container under such a key is walked, not judged. Some sensitive names
 *     hold config rather than a value — `auth.apiKey` is `{key, value, in}` —
 *     and a validator that rejected the container outright would make that
 *     block unsyncable. The sanitizer is free to be stricter and blank a whole
 *     container (it does, for request bodies): push may withhold more than the
 *     validators demand, never less.
 *   - Under any other key name, a string is kept unless it carries credential
 *     material outside of its `{{...}}` references.
 * ------------------------------------------------------------------------- */

/**
 * Key names whose values are withheld from a sync payload. Matched against a
 * camelCase-normalized key, so `apiKeys`, `userTokens` and `masterKek` are
 * caught the same way their snake_case spellings are — the validators
 * normalize too, and a predicate that misses a spelling one of them catches is
 * exactly what strands a workflow mid-sync.
 */
const SYNC_SENSITIVE_NAME_RE = /(?:^|[_-])(token|password|secret|api[_-]?key|private[_-]?key|client[_-]?secret|credential)s?$/

/**
 * Exact names that carry credentials without matching the pattern above:
 * transport auth/session headers, and this app's own vault field names (a
 * payload naming one of those is either a bug or a hostile server).
 * Exact-match on purpose — `cookies` is the config array holding cookie
 * entries, not a credential, and must survive.
 */
const SYNC_SENSITIVE_EXACT: ReadonlySet<string> = new Set([
  "authorization", "cookie", "set-cookie", "session", "sessionid", "sid", "jwt", "otp", "cvv",
  "ciphertext", "plaintext", "kek", "dek", "master_kek", "wrapped_dek", "hmac_secret",
  "secret_value", "encrypted_value", "encrypted_private_key",
])

/** True if a sync payload must not carry a literal value under this key name. */
export function isSyncSensitiveKey(key: string): boolean {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").trim().toLowerCase()
  return isSecretKey(key) || SYNC_SENSITIVE_NAME_RE.test(normalized) || SYNC_SENSITIVE_EXACT.has(normalized)
}

// Credential shapes that must never leave the machine. Deliberately narrow:
// request bodies and header values are workflow config, and a broad heuristic
// (anything containing "token") empties the config it is meant to protect.
const BEARER_CREDENTIAL_PATTERN = /\bbearer\s+[a-zA-Z0-9_.-]*[0-9_.-][a-zA-Z0-9_.-]*/i
const JWT_CREDENTIAL_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/
const STRIPE_LIVE_KEY_PATTERN = /\b(?:sk|pk)_live_[A-Za-z0-9_-]+\b/i
const REF_SPAN_RE = /\{\{[^{}]*\}\}/g

/**
 * Lowercase stem a per-call placeholder is built from. Lowercase on purpose: a
 * reference in a URL *host* is normalised to lowercase by `URL`, and a
 * mixed-case token would come back unmatchable. A per-call random suffix makes
 * the full token collision-safe against real text that happens to contain the
 * stem.
 */
const URL_REFERENCE_TOKEN_STEM = "apiweave-ref-"

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

/**
 * What all three components count as "already empty", and therefore always
 * allowed under a sync-sensitive key. Note what is absent: a number or boolean
 * is not empty, so `{"password": 0}` still has to be withheld.
 */
export function isEmptySyncValue(value: unknown): boolean {
  return value === undefined || value === null || value === ""
    || (Array.isArray(value) && value.length === 0)
    || (typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0)
}

/**
 * The one non-empty shape allowed under a sync-sensitive key: a value wired to
 * an `{{env.*}}`/`{{variables.*}}`/`{{prev...}}`/`{{secrets.*}}` slot on the
 * receiving machine, carrying no credential material of its own.
 */
export function isCredentialFreeReference(value: unknown): boolean {
  return typeof value === "string" && containsIndirectionRef(value) && !containsCredentialMaterial(value)
}

/**
 * The reference-preserving replacement shared by every redaction surface: a
 * credential-free `{{...}}` indirection keeps its value, everything else is
 * written back as `blank` (the sync blank, `<SECRET>`, or `[FILTERED]`). Keeping
 * the slot is the point — a dropped variable or header orphans the
 * `{{variables.NAME}}`/`{{secrets.NAME}}` reference elsewhere in the workflow.
 */
export function referenceOrBlank(value: unknown, blank: string): JsonValue {
  return isCredentialFreeReference(value) ? (value as JsonValue) : blank
}

/**
 * True when a string is nothing but `{{...}}` references (whitespace aside).
 * Cookie values are held to this stricter bar than a header's `Bearer
 * {{...}}`: session material can hide behind one appended reference, so only a
 * value that is purely a slot survives.
 */
export function isReferenceOnlyValue(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.replace(REF_SPAN_RE, "").trim() === ""
}

const TEMPLATED_URL_START_RE = /^\s*\{\{[^{}]*\}\}/

/**
 * True when a value is a URL built from a leading `{{...}}` base reference,
 * e.g. `{{env.BASE_URL}}/users?password=...`. The runtime supports prefixed
 * template bases, so redaction must too; otherwise the plain reference check
 * preserves the whole string and a literal credential in the query slips
 * through. A bare `{{env.BASE_URL}}` (no path or query) is not a URL template.
 */
export function isTemplatedUrl(value: string): boolean {
  const match = TEMPLATED_URL_START_RE.exec(value)
  if (match === null) {
    return false
  }
  return /[?/]/.test(value.slice(match[0].length))
}

/**
 * Sanitize an `extractors` mapping. Each value is a response path by schema, so
 * a valid path — or a `{{...}}` reference inside it — survives; a value that
 * carries credential material is withheld. This matters because the validators
 * exempt extractor *names* from the sensitive-key rule but still scan every
 * string, so a credential left here dead-letters the push.
 */
export function sanitizeExtractorValues(
  value: Record<string, JsonValue>,
  blank: string,
): Record<string, JsonValue> {
  const sanitized: Record<string, JsonValue> = {}
  for (const [name, path] of Object.entries(value)) {
    sanitized[name] = typeof path === "string" && containsCredentialMaterial(path) ? blank : path
  }
  return sanitized
}

/**
 * True if a value under a sync-sensitive key breaks the contract and must have
 * been withheld before the payload was pushed. Containers answer `false` — they
 * are walked instead, so a config block that happens to sit under a sensitive
 * name (`auth.apiKey`) can still cross the wire.
 */
export function isWithheldSyncValue(value: unknown): boolean {
  if (value !== null && typeof value === "object") {
    return false
  }
  return !isEmptySyncValue(value) && !isCredentialFreeReference(value)
}

/**
 * Redact a request body leaf-by-leaf, writing `blank` in place of each withheld
 * value. A body is workflow *config* that has to round-trip between devices, so
 * flattening it wholesale destroys the thing redaction is meant to protect;
 * only credential-shaped leaves are withheld. JSON bodies are walked
 * structurally, a non-JSON body is withheld whole only when it carries
 * credential material, and a body with nothing to redact comes back
 * byte-for-byte so redaction never shows up as a spurious diff.
 *
 * Shared by the cloud-sync push sanitizer (which blanks to `""`) and the export
 * bundler (which writes `<SECRET>`, so {@link findRedactedPlaceholders} can
 * catch that placeholder being written back). Only the blank token differs: a
 * body that syncs but cannot be exported — or the reverse — is exactly the
 * drift this one function exists to prevent.
 */
export function redactBodyLeaves(body: string, blank: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return containsCredentialMaterial(body) ? blank : body
  }
  const tally: RedactionTally = { redacted: false, blank }
  const sanitized = redactBodyValue(parsed, null, tally)
  return tally.redacted ? JSON.stringify(sanitized, null, 2) : body
}

/** Whether anything was withheld, so an untouched body can return verbatim. */
interface RedactionTally {
  redacted: boolean
  readonly blank: string
}

function redactBodyValue(value: unknown, keyName: string | null, tally: RedactionTally): JsonValue {
  if (keyName !== null && isSyncSensitiveKey(keyName)) {
    return withheldBodyValue(value, tally)
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactBodyValue(item, null, tally))
  }
  if (isRecord(value)) {
    return redactBodyRecord(value, tally)
  }
  if (typeof value === "string") {
    return containsCredentialMaterial(value) ? blankBody(tally) : value
  }
  return value as JsonValue
}

function redactBodyRecord(record: Record<string, JsonValue>, tally: RedactionTally): JsonValue {
  // Mirror the validators' `{key, value}` pair semantics: the sensitivity of a
  // pair lives in its sibling `key`, not in the literal name `value`.
  const pairKey = record["key"]
  const pairSensitive = typeof pairKey === "string" && isSyncSensitiveKey(pairKey)
  const sanitized: Record<string, JsonValue> = {}
  for (const [key, child] of Object.entries(record)) {
    sanitized[key] = pairSensitive && key === "value"
      ? withheldBodyValue(child, tally)
      : redactBodyValue(child, key, tally)
  }
  return sanitized
}

// In a body, a sensitive key name withholds its WHOLE value rather than its
// string leaves. The validators are content to walk a container and judge its
// leaves by name, which is what lets `auth.apiKey` sync; but inside a request
// body there is no schema to lean on, so an opaque credential one level down
// (`{"apiKey":{"v":"..."}}`) would have no leaf name to catch it.
function withheldBodyValue(value: unknown, tally: RedactionTally): JsonValue {
  if (isEmptySyncValue(value) || isCredentialFreeReference(value)) {
    return value as JsonValue
  }
  return blankBody(tally)
}

function blankBody(tally: RedactionTally): JsonValue {
  tally.redacted = true
  return tally.blank
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
  return mapForbiddenKeyFilteredEntries(data, (key, value) => sanitizeExportVariableValue(value, key))
}

/** One variable value: refs survive, secret-named keys and secret-shaped values are redacted. */
function sanitizeExportVariableValue(value: JsonValue, key: string | null): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeExportVariableValue(item, null))
  }
  if (isRecord(value)) {
    return mapForbiddenKeyFilteredEntries(value, (nestedKey, nestedValue) =>
      sanitizeExportVariableValue(nestedValue, nestedKey))
  }
  if (typeof value !== "string") {
    return value
  }
  return sanitizeExportVariableString(value, key)
}

/**
 * The string leaf of {@link sanitizeExportVariableValue}: URL-shaped, reference,
 * secret-named-key and secret-looking-value handling, in the order the
 * contract requires (see the case-by-case notes below).
 */
const ABSOLUTE_URL_START_RE = /^[a-z][a-z0-9+.-]*:\/\//i

// Under a secret-named key, a URL-shaped value survives export only as a
// credential-free reference; a literal one is withheld whole rather than
// exported (the surgical URL redaction below handles the non-secret-key case).
function isLiteralSecretKeyUrl(value: string, key: string | null): boolean {
  return key !== null && isSecretKey(key) && !isCredentialFreeReference(value)
}

function sanitizeExportVariableString(value: string, key: string | null): JsonValue {
  // URL-shaped: strip embedded credentials/fragment surgically rather than
  // nuking the whole value — a URL commonly contains "token"-ish substrings
  // (e.g. an `access_token` fragment key) that aren't the full secret. A
  // base-reference template (`{{env.BASE_URL}}/login?password=...`) is a URL
  // here too, or its literal query would be preserved as part of a
  // "reference". The URL walk is itself reference-aware, and running it before
  // the plain reference check is what stops a reference elsewhere in the URL
  // from laundering a literal secret query value (`?password=abc1234`).
  if (ABSOLUTE_URL_START_RE.test(value) || isTemplatedUrl(value)) {
    if (isLiteralSecretKeyUrl(value, key)) {
      return SECRET_PLACEHOLDER
    }
    return sanitizeUrlForExport(value)
  }
  // A `{{...}}` indirection is a reference, not the secret, so it must be
  // checked before the key-name heuristic: `{{variables.token}}` under a key
  // literally named `token` is exactly the wiring export has to preserve. This
  // covers every namespace the runtime resolves, not just `{{secrets.*}}`.
  if (isCredentialFreeReference(value)) {
    return value
  }
  if (key !== null && isSecretKey(key)) {
    return SECRET_PLACEHOLDER
  }
  return looksLikeSecretValue(value) ? SECRET_PLACEHOLDER : value
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
 * redaction unnoticed. A leaf that is a credential-free `{{env.*}}` /
 * `{{variables.*}}` / `{{prev...}}` / `{{secrets.*}}` reference survives in
 * every mode, the same as it already does for headers/cookies/body: it names a
 * slot, not the secret, so another user re-importing the bundle keeps their own
 * `{{variables.token}}` wiring instead of finding `<SECRET>` in its place.
 */
function sanitizeAuthConfigForExport(auth: Record<string, JsonValue>): Record<string, JsonValue> {
  const sanitized: Record<string, JsonValue> = { ...auth }
  const { bearer, basic, apiKey } = sanitized
  const leaf = (value: string): JsonValue => (isCredentialFreeReference(value) ? value : SECRET_PLACEHOLDER)
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
 * `export` drops entries whose key names a secret and whose value is a literal,
 * so an imported bundle forces the operator to re-enter the credential rather
 * than sending a placeholder upstream (a `{{...}}` reference still survives);
 * `redactAllValues` additionally blanks every remaining value regardless of key
 * name (used for cookies, which routinely carry session material under
 * non-secret-looking names).
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

/** One `{key, value}` entry, or `undefined` when export mode drops a literal secret entry. */
function sanitizeKeyValueEntry(
  item: JsonValue,
  redactAllValues: boolean,
  mode: SanitizeMode,
): JsonValue | undefined {
  if (!isRecord(item)) return item
  const key = item["key"]
  const secretKey = typeof key === "string" && isSecretKey(key)
  const value = item["value"]
  if (typeof value !== "string") return item
  if (isPreservedReferenceValue(value, redactAllValues)) {
    return item
  }
  // Export still drops a literal secret-named entry (rather than writing a
  // placeholder the operator might send upstream); an agent read keeps it.
  if (secretKey && mode === "export") return undefined
  return withholdsPairValue(value, secretKey, redactAllValues)
    ? { ...item, value: SECRET_PLACEHOLDER }
    : item
}

// A credential-free `{{...}}` reference is the slot's wiring, not the secret,
// so it survives even under a secret-named key that export would otherwise
// drop outright. Cookies (redactAllValues) trust only a value that is purely
// the reference.
function isPreservedReferenceValue(value: string, redactAllValues: boolean): boolean {
  return isCredentialFreeReference(value) && (!redactAllValues || isReferenceOnlyValue(value))
}

/**
 * Whether a `{key, value}` pair's value must be withheld.
 *
 * `redactAllValues` (cookies) withholds values even when their key name looks
 * harmless — session material hides under names that look benign — but a value
 * that is purely a `{{...}}` indirection reference still names a slot and
 * survives. Otherwise only a secret-named key withholds, and even then a
 * credential-free `{{...}}` indirection reference in any
 * namespace (env, variables, prev, secrets) survives: it is a reference, not
 * the secret, and seeing it is how an agent knows which slot a credential
 * binds to. A reference string that also carries credential material outside
 * its `{{...}}` span (e.g. a stray JWT appended to it) is still withheld.
 */
function withholdsPairValue(value: string, secretKey: boolean, redactAllValues: boolean): boolean {
  if (redactAllValues) return true
  if (isCredentialFreeReference(value)) return false
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
 * `{{...}}` references are preserved byte-for-byte (see
 * {@link sanitizeUrlWithReferences}).
 */
function sanitizeUrlForExport(value: string): string {
  return sanitizeUrlWithReferences(value, SECRET_PLACEHOLDER, isSecretKey)
}

/**
 * The shared URL redactor for both export and cloud sync, differing only in the
 * `blank` token and which key names count as sensitive.
 *
 * A `URL` round-trip reconstructs its query string through `URLSearchParams`,
 * which percent-encodes the braces of a `{{variables.token}}` reference and
 * silently breaks runtime substitution. So reference spans are swapped for
 * per-call lowercase tokens before parsing and written back after serialization:
 * the reference text is preserved exactly, while a value that also carries
 * credential material is still withheld (a reference never launders a literal).
 *
 * A scheme-less template base (`{{env.BASE_URL}}/login?password=...`) is parsed
 * behind a throwaway `http://` scheme and that prefix is stripped again, so a
 * literal credential in a templated URL is redacted instead of preserved whole.
 */
export function sanitizeUrlWithReferences(
  value: string,
  blank: string,
  isSensitiveKey: (key: string) => boolean,
): string {
  const { tokenized, restore } = tokenizeUrlReferences(value)
  const parsed = parseTokenizedUrl(tokenized, value)
  if (parsed === undefined) {
    return containsCredentialMaterial(value) ? blank : value
  }
  const { url, syntheticScheme } = parsed

  const componentsChanged = redactUrlComponents(url)
  const queryChanged = redactUrlQueryParams(url, blank, isSensitiveKey, restore)
  if (!componentsChanged && !queryChanged) {
    return value
  }
  const serialized = url.toString()
  const withoutSynthetic = syntheticScheme !== "" && serialized.startsWith(syntheticScheme)
    ? serialized.slice(syntheticScheme.length)
    : serialized
  return restore(withoutSynthetic)
}

/** Swap `{{...}}` reference spans for per-call tokens a `URL` round-trip won't mangle. */
function tokenizeUrlReferences(value: string): { tokenized: string; restore: (text: string) => string } {
  const references: string[] = []
  const stem = `${URL_REFERENCE_TOKEN_STEM}${Math.random().toString(36).slice(2, 10)}-`
  const tokenPattern = new RegExp(`${stem}(\\d+)`, "g")
  const tokenized = value.replace(REF_SPAN_RE, (match) => {
    const token = `${stem}${references.length}`
    references.push(match)
    return token
  })
  const restore = (text: string): string =>
    text.replace(tokenPattern, (match, index: string) => references[Number(index)] ?? match)
  return { tokenized, restore }
}

/**
 * Parse the tokenized value as a `URL`, retrying behind a throwaway
 * `http://` scheme for a scheme-less template base. `undefined` means neither
 * parse succeeded, so the caller falls back to the plain value-level heuristic.
 */
function parseTokenizedUrl(
  tokenized: string,
  original: string,
): { url: URL; syntheticScheme: string } | undefined {
  try {
    return { url: new URL(tokenized), syntheticScheme: "" }
  } catch {
    if (!isTemplatedUrl(original)) {
      return undefined
    }
    try {
      return { url: new URL(`http://${tokenized}`), syntheticScheme: "http://" }
    } catch {
      return undefined
    }
  }
}

/** Strip userinfo, fragment and any credential-looking path segment. Returns whether it changed anything. */
function redactUrlComponents(url: URL): boolean {
  let changed = false
  if (url.username !== "" || url.password !== "") {
    url.username = ""
    url.password = ""
    changed = true
  }
  if (url.hash !== "") {
    url.hash = ""
    changed = true
  }
  const sanitizedPath = url.pathname
    .split("/")
    .map((segment) => (containsCredentialMaterial(segment) ? "" : segment))
    .join("/")
  if (sanitizedPath !== url.pathname) {
    url.pathname = sanitizedPath
    changed = true
  }
  return changed
}

/** Blank a sensitive-key or credential-looking query value in place. Returns whether it changed anything. */
function redactUrlQueryParams(
  url: URL,
  blank: string,
  isSensitiveKey: (key: string) => boolean,
  restore: (text: string) => string,
): boolean {
  // Iterate *entries*, not keys: `get(key)`/`set(key, ...)` collapses duplicate
  // parameters, which would let `?password={{variables.p}}&password=literal`
  // keep the literal behind the first (reference) value.
  let queryChanged = false
  const sanitizedEntries = [...url.searchParams.entries()].map(([key, queryValue]) => {
    const original = restore(queryValue)
    if (isCredentialFreeReference(original)) {
      return [key, queryValue] as const
    }
    if (isSensitiveKey(key) || containsCredentialMaterial(original)) {
      queryChanged = true
      return [key, blank] as const
    }
    return [key, queryValue] as const
  })
  if (queryChanged) {
    url.search = ""
    for (const [key, queryValue] of sanitizedEntries) {
      url.searchParams.append(key, queryValue)
    }
  }
  return queryChanged
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
  auth: (value) => (isRecord(value) ? sanitizeAuthConfigForExport(value) : undefined),
  fileUploads: (value) => (Array.isArray(value) ? sanitizeFileUploadsForExport(value) : undefined),
  cookies: (value, mode) => (Array.isArray(value) ? sanitizeKeyValueArray(value, true, mode) : undefined),
  // Extractor values are response paths ("response.body.data.access_token") by
  // schema definition — never credentials — and the `token`-ish variable names
  // they map from would otherwise be redacted by the key-name heuristic below.
  // The path itself is still scanned: a credential pasted as a path is withheld
  // so it cannot dead-letter a push or ride an export bundle.
  extractors: (value) => (isRecord(value) ? sanitizeExtractorValues(value, SECRET_PLACEHOLDER) : undefined),
  url: (value) => (typeof value === "string" ? sanitizeUrlForExport(value) : undefined),
  // Export redacts a body leaf-by-leaf rather than flattening it to the
  // placeholder. A body is workflow config, and the bundle it lands in is what
  // rebuilds that workflow on another machine — flattening loses every request
  // payload in the project and, because `<SECRET>` is a valid string for
  // `HTTPNodeDataSchema.body`, re-importing it writes the placeholder back as
  // if it were real config. The credential floor is unchanged: this is the same
  // walk, and the same contract, that the cloud-sync push sanitizer applies.
  body: (value, mode) => {
    if (typeof value !== "string" || value.trim().length === 0) return undefined
    return mode === "export" ? redactBodyLeaves(value, SECRET_PLACEHOLDER) : sanitizeBodyForAgentRead(value)
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
    return isCredentialFreeReference(value) ? value : SECRET_PLACEHOLDER
  }
  return undefined
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
    if (isForbiddenSecretStorageKey(key)) {
      continue
    }
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
      const dedupeKey = `${name}\0${scopeType}\0${scopeId}`
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
