/**
 * One `{{scope.name…}}` placeholder: `{{variables.case.items[0].title}}` is
 * scope `variables`, root name `case` and path `.items[0].title`. A reference
 * is to its root name; the path only says which part of the value is read.
 */
export interface PlaceholderReference {
  readonly scope: "variables" | "env" | "secrets" | "data"
  readonly name: string
  /** What follows the root name, as written: `""`, `.title` or `[0].id`. */
  readonly path: string
}
