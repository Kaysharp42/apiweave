import { SECRET_PLACEHOLDER } from "../services/secret_utils"

/**
 * Values shorter than this are not masked. A one-to-three character secret
 * protects nothing, and masking it would rewrite unrelated text (status codes,
 * ids, words) across every stored result until the history is unreadable.
 */
export const MIN_MASKED_SECRET_LENGTH = 4

const BASIC_AUTH = /\bBasic\s+([A-Za-z0-9+/]+={0,2})/gi

/**
 * Build a per-run masker over the secret values the run resolved. The returned
 * function deep-copies any JSON-shaped value with every occurrence of a secret
 * replaced by `<SECRET>` — in strings and in object keys. It is applied at the
 * scheduler's persistence/emission boundary only; the executor keeps the real
 * values, so the next node still sends them.
 *
 * Beyond the raw value it catches the forms a value takes on the wire: URL
 * encoding (`%20` and form `+`), JSON string escaping, and an `Authorization:
 * Basic` credential whose base64 decodes to text containing a secret. Longer
 * values are matched first, so a secret that contains another is masked whole.
 */
export function createSecretMasker(values: Iterable<string>): <T>(value: T) => T {
  const secrets = [...values].filter((value) => value.length >= MIN_MASKED_SECRET_LENGTH)
  if (secrets.length === 0) return (value) => value

  const variants = new Set<string>()
  /**
   * Add a URL parser's encoding of the secret, but only when it represents the
   * whole value: the parser stops a query at `#` and a path at `?`/`#`, and
   * normalises `..`, so a shortened form (a prefix of a longer secret) would
   * mask unrelated text that happens to start the same way.
   */
  const addUrlForm = (secret: string, form: string): void => {
    if (form.length < MIN_MASKED_SECRET_LENGTH) return
    try {
      if (decodeURIComponent(form) === secret) variants.add(form)
    } catch {
      // Not decodable: keep the other forms.
    }
  }
  for (const secret of secrets) {
    variants.add(secret)
    variants.add(encodeURIComponent(secret))
    variants.add(new URLSearchParams({ v: secret }).toString().slice(2))
    variants.add(JSON.stringify(secret).slice(1, -1))
    // `new URL` encodes query and path segments differently from both encoders
    // above — a space is `%20` but a slash stays `/` — which is exactly how a
    // secret appears when a page puts one in its address.
    try {
      addUrlForm(secret, new URL(`https://x.test/?q=${secret}`).search.slice(3))
    } catch {
      // A value the URL parser rejects keeps its other forms.
    }
    try {
      addUrlForm(secret, new URL(`https://x.test/${secret}`).pathname.slice(1))
    } catch {
      // A value the URL parser rejects keeps its other forms.
    }
  }
  const pattern = new RegExp(
    [...variants].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|"),
    "g",
  )

  const maskString = (text: string): string =>
    text
      .replace(BASIC_AUTH, (match, encoded: string) => {
        const decoded = Buffer.from(encoded, "base64").toString("utf8")
        return secrets.some((secret) => decoded.includes(secret)) ? `Basic ${SECRET_PLACEHOLDER}` : match
      })
      .replace(pattern, SECRET_PLACEHOLDER)

  const mask = (value: unknown): unknown => {
    if (typeof value === "string") return maskString(value)
    if (Array.isArray(value)) return value.map(mask)
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [maskString(key), mask(entry)]))
    }
    return value
  }
  return <T>(value: T): T => mask(value) as T
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
