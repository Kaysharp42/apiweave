import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { applyEdits, modify, parse, printParseErrorCode, type FormattingOptions, type ParseError } from "jsonc-parser"

/**
 * Read and edit one entry of another application's JSON config, leaving every
 * other byte alone. These files belong to the user and to their client: they
 * hold comments (OpenCode and VS Code read JSONC), other servers, and settings
 * APIWeave knows nothing about. So nothing is ever re-serialized — jsonc-parser
 * computes the minimal text edit for the one path, the way VS Code edits its
 * own settings.
 */

/** A file whose text cannot be parsed. Editing it would mean guessing, so the user is asked to fix it. */
export class UnreadableConfigError extends Error {}

/** The value at `keys`, or undefined when the file or the entry is missing. */
export function readJsoncEntry(filePath: string, keys: readonly string[]): unknown {
  const text = readText(filePath)
  if (text === null || text.trim() === "") return undefined
  let value: unknown = parseOrThrow(filePath, text)
  for (const key of keys) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
    value = (value as Record<string, unknown>)[key]
  }
  return value
}

/** Set (or, with `undefined`, remove) the entry at `keys`, creating the file and its parents when missing. */
export function writeJsoncEntry(filePath: string, keys: readonly string[], value: unknown): void {
  const existing = readText(filePath)
  if (existing === null && value === undefined) return
  const text = existing === null || existing.trim() === "" ? "{}\n" : existing
  parseOrThrow(filePath, text)
  const edits = modify(text, [...keys], value, { formattingOptions: formattingOf(text) })
  if (edits.length === 0) return
  mkdirSync(path.dirname(filePath), { recursive: true })
  // Through a temporary file: the client may read its config at any moment.
  const temporary = `${filePath}.apiweave-${process.pid}.tmp`
  writeFileSync(temporary, applyEdits(text, edits))
  renameSync(temporary, filePath)
}

function readText(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw new UnreadableConfigError(`${filePath} cannot be read: ${(error as Error).message}`)
  }
}

function parseOrThrow(filePath: string, text: string): unknown {
  const errors: ParseError[] = []
  const value: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false })
  const first = errors[0]
  if (first !== undefined) {
    throw new UnreadableConfigError(`${filePath} is not valid JSON (${printParseErrorCode(first.error)} at offset ${first.offset}). Fix it, then try again.`)
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UnreadableConfigError(`${filePath} does not hold a JSON object. Fix it, then try again.`)
  }
  return value
}

/** Indent the new entry the way the file already is: tabs, or the width of its first indented line. */
function formattingOf(text: string): FormattingOptions {
  const indent = /^([ \t]+)\S/m.exec(text)?.[1]
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  if (indent?.startsWith("\t")) return { insertSpaces: false, tabSize: 1, eol }
  return { insertSpaces: true, tabSize: indent?.length ?? 2, eol }
}
