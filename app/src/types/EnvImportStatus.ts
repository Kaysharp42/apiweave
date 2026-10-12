/**
 * What importing a row does: adds it (`new`), replaces a different value or a
 * plain variable it moves into the secret store (`changed`), nothing
 * (`unchanged`), or replaces a stored secret whose value is never read back,
 * so it cannot be compared (`exists`).
 */
export type EnvImportStatus = "new" | "changed" | "unchanged" | "exists";
