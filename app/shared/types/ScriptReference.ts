/**
 * One `aw.<scope>.get("NAME")` or `aw.<scope>.set("NAME", …)` call in a
 * script, named by a literal. `write` is true for `set`.
 */
export interface ScriptReference {
  readonly scope: "variables" | "env" | "secrets"
  readonly name: string
  readonly write: boolean
}
