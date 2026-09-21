/**
 * One entry in the `{{…}}` autocomplete list.
 *
 * `insert` is the expression that goes *between* the braces, which is also
 * what the filter matches on — so a suggestion is identified by the thing the
 * user is typing, not by a label beside it.
 */
export interface TemplateSuggestion {
  /** The expression written between the braces, e.g. `variables.token`. */
  readonly insert: string;
  /** What it is: drives the badge and the resting order of the list. */
  readonly kind: "variable" | "env" | "secret" | "response" | "function";
  /**
   * Muted right-hand hint — a value preview or a signature. Never a secret
   * value: a secret's entry carries its name and nothing else.
   */
  readonly detail?: string;
  /**
   * Where the caret lands inside `insert` after acceptance. Only functions set
   * it (inside the parens, ready for an argument); everything else leaves the
   * caret after the closing braces, which is where the next character goes.
   */
  readonly caretOffset?: number;
}
