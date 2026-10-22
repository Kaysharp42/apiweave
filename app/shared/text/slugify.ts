/** Derive a slug from a display name: lowercase ASCII words joined by `-`. Falls back to `fallback` when a name has no slug-able characters. */
export function slugify(name: string, fallback: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug.length > 0 ? slug : fallback
}
