import type { JsonValue } from "../types/JsonValue"

/**
 * The data set of a data-driven run: one row per iteration, each row's
 * values reachable as `{{data.<column>}}`. Read from a CSV file (the header
 * row names the columns, every value is a string) or a JSON array of objects
 * (values keep their JSON type; a nested object or array is inserted as JSON).
 *
 * Shared by the headless CLI and the renderer, which parses the file the user
 * picks and sends the rows over IPC.
 */

/** Most rows a data set may hold. */
export const MAX_ITERATION_ROWS = 10_000
/** Largest data file read, in bytes. */
export const MAX_ITERATION_DATA_BYTES = 5 * 1024 * 1024

export type IterationRow = Record<string, JsonValue>

/** `fileName` picks the format: `.json` is JSON, anything else CSV. Throws an Error naming the problem. */
export function parseIterationData(text: string, fileName: string): IterationRow[] {
  const rows = fileName.toLowerCase().endsWith(".json") ? parseJsonRows(text) : parseCsvRows(text)
  if (rows.length === 0) throw new Error(`${fileName} has no data rows`)
  if (rows.length > MAX_ITERATION_ROWS) throw new Error(`${fileName} has ${rows.length} rows; the limit is ${MAX_ITERATION_ROWS}`)
  return rows
}

function parseJsonRows(text: string): IterationRow[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripBom(text))
  } catch (error) {
    throw new Error(`not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!Array.isArray(parsed)) throw new Error("JSON data must be an array of objects")
  return parsed.map((row: unknown, index) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new Error(`JSON data row ${index + 1} is not an object`)
    }
    return row as IterationRow
  })
}

function parseCsvRows(text: string): IterationRow[] {
  const [header, ...records] = parseCsv(text)
  if (header === undefined) return []
  const seen = new Set<string>()
  for (const name of header) {
    if (name === "") throw new Error("CSV header has an empty column name")
    if (seen.has(name)) throw new Error(`CSV header names column '${name}' twice`)
    seen.add(name)
  }
  return records.map((record, index) => {
    if (record.length !== header.length) {
      throw new Error(`CSV row ${index + 1} has ${record.length} fields; the header has ${header.length}`)
    }
    return Object.fromEntries(header.map((name, column) => [name, record[column]!]))
  })
}

/**
 * RFC 4180 records: fields separated by commas, records by CRLF or LF, a
 * field in double quotes may hold commas, line breaks and `""` for a quote.
 * A leading byte-order mark is dropped, and so are blank lines.
 */
export function parseCsv(text: string): string[][] {
  const source = stripBom(text)
  const records: string[][] = []
  let record: string[] = []
  let field = ""
  let quoted = false
  // A line holding only `""` is a record with one empty value, not a blank line.
  let sawQuote = false
  let index = 0
  const endRecord = (): void => {
    record.push(field)
    // A blank line is one empty field; it is not a record.
    if (record.length > 1 || record[0] !== "" || sawQuote) records.push(record)
    record = []
    field = ""
    sawQuote = false
  }
  while (index < source.length) {
    const character = source[index]!
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }
        quoted = false
      } else {
        field += character
      }
      index += 1
      continue
    }
    if (character === '"' && field === "") {
      quoted = true
      sawQuote = true
    } else if (character === ",") {
      record.push(field)
      field = ""
    } else if (character === "\n" || character === "\r") {
      endRecord()
      if (character === "\r" && source[index + 1] === "\n") index += 1
    } else {
      field += character
    }
    index += 1
  }
  if (quoted) throw new Error("CSV has an unterminated quoted field")
  if (field !== "" || record.length > 0 || sawQuote) endRecord()
  return records
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}
