/**
 * Small mapping utilities shared by every repository. Repositories translate
 * the rich camelCase domain aggregates (shared/types) onto the generic SQLite
 * columns (core/db/migrations/001_init.sql) and back — these helpers keep that
 * codec boilerplate in one place.
 */

/** Parse a JSON column into a known shape. The DB is local and only ever
 * written by us, so we trust the stored JSON rather than re-validating here
 * (zod validation lives at the IPC boundary, Task 11). */
export function parseJson<T>(text: string): T {
  return JSON.parse(text) as T
}

export function toJson(value: unknown): string {
  return JSON.stringify(value)
}

/** Derive a NOT-NULL slug column from a display name. The schema keeps `slug`
 * for future routing/sync; the domain types don't expose it, so repositories
 * synthesize it. Falls back to the row id when a name has no slug-able chars. */
export function slugify(name: string, fallback: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug.length > 0 ? slug : fallback
}

/** A freshly inserted/updated row is read straight back; its absence is a
 * broken invariant, not a not-found the caller should handle. */
export function mustExist<T>(row: T | undefined, message: string): T {
  if (row === undefined) {
    throw new Error(message)
  }
  return row
}
