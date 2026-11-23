/**
 * Where in a browser step's config a literal sits: one of the action's value
 * fields, one entry of a select's `values`, or a text field of its locator.
 */
export type StepLiteralField =
  | "value"
  | "text"
  | `values.${number}`
  | "locator.name"
  | "locator.value"
  | "locator.hasText";
