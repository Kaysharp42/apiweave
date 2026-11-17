import { MIN_MASKED_SECRET_LENGTH } from "../secret_masker"

/**
 * What a recording compares typed text against. Held in main for the length
 * of one recording and never sent anywhere: only the templates built from it
 * leave.
 */
export interface RecordingValues {
  /** The selected environment's variables that are strings, name → value. */
  readonly env: Readonly<Record<string, string>>
  /** Every secret the workflow's scope chain resolves, name → plaintext. */
  readonly secrets: Readonly<Record<string, string>>
}

/** A fill's text as it may leave main. */
export type TemplatedText =
  /** Safe to send: literal text, possibly with `{{env.*}}` or `{{secrets.*}}` in it. */
  | { readonly kind: "value"; readonly value: string }
  /** The text ends in the start of a secret: sending it would send part of the secret. */
  | { readonly kind: "withheld" }
  /** A password that is no stored secret: the step gets a placeholder secret the user sets. */
  | { readonly kind: "unset" }

/** The secret names whose value is exactly `text`, first by name so a recording is repeatable. */
function secretNamed(text: string, values: RecordingValues): string | undefined {
  return Object.keys(values.secrets)
    .sort()
    .find((name) => values.secrets[name] === text)
}

/** Secrets long enough to be masked in a run, longest first so a secret inside another is never matched first. */
function maskableSecrets(values: RecordingValues): Array<readonly [name: string, value: string]> {
  return Object.entries(values.secrets)
    .filter(([, value]) => value.length >= MIN_MASKED_SECRET_LENGTH)
    .sort(([a, first], [b, second]) => second.length - first.length || a.localeCompare(b))
}

/** True when `text` contains a secret a run would mask. */
export function containsSecret(text: string, values: RecordingValues): boolean {
  return maskableSecrets(values).some(([, value]) => text.includes(value))
}

/**
 * True when `text` contains a secret or ends in the start of one. For the
 * page text a locator is built from: Playwright shortens an element's name to
 * a unique prefix, so a button labelled `Key tok-123456` can be located by
 * `Key tok-`, which is part of the secret.
 */
export function showsSecret(text: string, values: RecordingValues): boolean {
  return containsSecret(text, values) || endsInSecretPrefix(text, values)
}

/**
 * True when `text` ends in the beginning of a secret: the user may be typing
 * it right now, one key per update. Shorter tails than a run masks never count.
 */
function endsInSecretPrefix(text: string, values: RecordingValues): boolean {
  for (const [, secret] of maskableSecrets(values)) {
    for (let length = Math.min(text.length, secret.length - 1); length >= MIN_MASKED_SECRET_LENGTH; length--) {
      if (secret.startsWith(text.slice(text.length - length))) return true
    }
  }
  return false
}

/**
 * Turn the text the user typed into a field into what the workflow stores.
 *
 * - The whole text is a secret's value: `{{secrets.NAME}}`.
 * - A password field that matches no secret: `unset`. Its text is never sent,
 *   not even half typed.
 * - The whole text is an environment variable's value and at least as long as
 *   a value a run masks: `{{env.KEY}}`, so the test account's email typed from
 *   `TEST_EMAIL` stays tied to it. A shorter text stays literal, because `10`
 *   typed into a quantity field is not the environment's `PAGE_SIZE`.
 * - Otherwise the text itself, with any secret inside it replaced by its
 *   template, unless it ends in the start of a secret (`withheld`).
 */
export function templateFill(text: string, values: RecordingValues, password: boolean): TemplatedText {
  if (text === "") return { kind: "value", value: "" }
  const secret = secretNamed(text, values)
  if (secret !== undefined) return { kind: "value", value: `{{secrets.${secret}}}` }
  if (password) return { kind: "unset" }
  if (text.length >= MIN_MASKED_SECRET_LENGTH) {
    const variable = Object.keys(values.env)
      .sort()
      .find((key) => values.env[key] === text)
    if (variable !== undefined) return { kind: "value", value: `{{env.${variable}}}` }
  }
  let value = text
  for (const [name, secretValue] of maskableSecrets(values)) value = value.split(secretValue).join(`{{secrets.${name}}}`)
  return endsInSecretPrefix(value, values) ? { kind: "withheld" } : { kind: "value", value }
}

/**
 * Turn the text a check from the recorder toolbar expects into what the
 * workflow stores. Checks refuse `{{secrets.*}}`, so a text that is a secret,
 * of any length, or contains one cannot be recorded at all: null. Otherwise
 * the same rule as a fill: the whole text equal to an environment variable
 * (at least as long as a value a run masks) becomes `{{env.KEY}}`, anything
 * else stays as it is.
 */
export function templateCheck(text: string, values: RecordingValues): string | null {
  if (secretNamed(text, values) !== undefined || containsSecret(text, values)) return null
  if (text.length < MIN_MASKED_SECRET_LENGTH) return text
  const variable = Object.keys(values.env)
    .sort()
    .find((key) => values.env[key] === text)
  return variable === undefined ? text : `{{env.${variable}}}`
}

/** True when `url` continues `prefix` at a boundary, so `http://host:80` never matches `http://host:8080`. */
function continuesAtBoundary(url: string, prefix: string): boolean {
  if (!url.startsWith(prefix)) return false
  const next = url.charAt(prefix.length)
  return prefix.endsWith("/") || next === "" || next === "/" || next === "?" || next === "#"
}

/**
 * A recorded page address with its start replaced by the environment variable
 * that holds it (`{{env.BASE_URL}}/login`), the longest such value winning.
 * Null when it contains a secret: a navigate may not carry `{{secrets.*}}`, so
 * such an address cannot be recorded at all.
 */
export function templateUrl(url: string, values: RecordingValues): string | null {
  if (containsSecret(url, values)) return null
  const base = Object.entries(values.env)
    .filter(([, value]) => /^https?:\/\//i.test(value) && continuesAtBoundary(url, value))
    .sort(([a, first], [b, second]) => second.length - first.length || a.localeCompare(b))[0]
  return base === undefined ? url : `{{env.${base[0]}}}${url.slice(base[1].length)}`
}
