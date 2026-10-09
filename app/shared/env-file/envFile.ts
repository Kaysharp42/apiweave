import { containsCredentialMaterial, isSecretKey } from "../credentials/credentials"
import type { ImportedVariable } from "../types/ImportedVariable"
import type { VariablesFile } from "../types/VariablesFile"

/**
 * Variables files, shared by the renderer's environment import/export and the
 * CLI's --env-file / --secrets-file: dotenv text, a flat JSON object, or a
 * Postman environment export. Plain TypeScript (no node:util.parseEnv) so the
 * renderer and the CLI read a .env file the same way.
 */

/** `KEY=` at a line start, with an optional `export ` prefix. */
const ASSIGNMENT_RE = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][\w.-]*)[ \t]*=[ \t]*/
const DOTENV_KEY_RE = /^[A-Za-z_][\w.-]*$/
const BARE_VALUE_RE = /^[\w./:@%+,=~?&-]*$/
const ESCAPES: Readonly<Record<string, string>> = { n: "\n", r: "\r", t: "\t" }

/**
 * dotenv lines as variables, later lines winning. Supports `export KEY=v`,
 * `#` comments (whole-line, or after an unquoted value), and single, double or
 * backtick quotes, which may span lines. Inside double quotes `\n`, `\r`, `\t`,
 * `\"` and `\\` are escapes; single and backtick quotes are literal. Lines that
 * are not assignments are skipped.
 */
export function parseDotenv(text: string): Record<string, string> {
  const source = text.replace(/\r\n?/g, "\n")
  const values = new Map<string, string>()
  let at = 0
  while (at < source.length) {
    const lineEnd = endOfLine(source, at)
    const match = ASSIGNMENT_RE.exec(source.slice(at, lineEnd))
    if (match === null) {
      at = lineEnd + 1
      continue
    }
    const key = match[1]!
    const valueStart = at + match[0].length
    const quote = source[valueStart]
    if (quote === '"' || quote === "'" || quote === "`") {
      const close = closingQuote(source, valueStart + 1, quote)
      if (close !== -1) {
        const raw = source.slice(valueStart + 1, close)
        values.set(key, quote === '"' ? raw.replace(/\\([nrt"\\])/g, (_, c: string) => ESCAPES[c] ?? c) : raw)
        at = endOfLine(source, close) + 1
        continue
      }
    }
    // Unquoted (or an unclosed quote): the rest of the line up to a comment.
    values.set(key, source.slice(valueStart, lineEnd).split("#", 1)[0]!.trim())
    at = lineEnd + 1
  }
  return Object.fromEntries(values)
}

/** Variables as dotenv text that `parseDotenv` reads back unchanged. Keys dotenv cannot name are left out, with a comment. */
export function toDotenv(variables: Readonly<Record<string, string>>): string {
  return Object.entries(variables)
    .map(([key, value]) => {
      if (!DOTENV_KEY_RE.test(key)) return `# skipped ${JSON.stringify(key)}: not a valid .env name`
      if (BARE_VALUE_RE.test(value)) return `${key}=${value}`
      const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r")
      return `${key}="${escaped}"`
    })
    .join("\n") + "\n"
}

/** True for a Postman environment export (`{ name, values: [...] }`). */
export function isPostmanEnvironment(value: unknown): boolean {
  return isRecord(value) && Array.isArray(value["values"]) && typeof value["name"] === "string"
}

/**
 * A variables file by content: JSON when it starts with `{`, dotenv otherwise.
 * A JSON object must be flat — a nested object or array is an error naming the
 * key, because an environment variable is one text value. Postman entries that
 * are disabled are skipped. Throws `SyntaxError` for bad JSON, `Error` otherwise.
 */
export function parseVariablesFile(text: string): VariablesFile {
  if (!text.trimStart().startsWith("{")) {
    return { format: "dotenv", variables: Object.entries(parseDotenv(text)).map(([key, value]) => variable(key, value, false)) }
  }
  const parsed: unknown = JSON.parse(text)
  if (!isRecord(parsed)) throw new Error("The file must hold a JSON object")
  if (isPostmanEnvironment(parsed)) {
    // Keyed by name, so a repeated key keeps its last value, as in a .env file.
    const byKey = new Map<string, ImportedVariable>()
    for (const entry of (parsed["values"] as unknown[]).filter(isRecord)) {
      const key = entry["key"]
      if (entry["enabled"] === false || typeof key !== "string" || key === "") continue
      byKey.delete(key)
      byKey.set(key, variable(key, scalarText(key, entry["value"]), entry["type"] === "secret"))
    }
    return { format: "postman", variables: [...byKey.values()] }
  }
  return {
    format: "json",
    variables: Object.entries(parsed).map(([key, value]) => variable(key, scalarText(key, value), false)),
  }
}

function variable(key: string, value: string, typedSecret: boolean): ImportedVariable {
  return { key, value, suggestSecret: typedSecret || isSecretKey(key) || containsCredentialMaterial(value) }
}

function scalarText(key: string, value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "object") {
    throw new Error(`"${key}" holds ${Array.isArray(value) ? "an array" : "an object"}; environment variables are flat text values`)
  }
  return String(value)
}

function endOfLine(source: string, from: number): number {
  const end = source.indexOf("\n", from)
  return end === -1 ? source.length : end
}

/** Index of the quote closing a value that opened before `from`; a backslash escapes a double quote. */
function closingQuote(source: string, from: number, quote: string): number {
  for (let index = from; index < source.length; index += 1) {
    if (quote === '"' && source[index] === "\\") index += 1
    else if (source[index] === quote) return index
  }
  return -1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
