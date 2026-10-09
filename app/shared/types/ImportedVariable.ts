/** One variable read from a .env, JSON or Postman environment file. */
export interface ImportedVariable {
  readonly key: string
  readonly value: string
  /** The key's name or the value looks like a credential (or Postman typed it secret). */
  readonly suggestSecret: boolean
}
