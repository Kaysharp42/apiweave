/** The live `{{…` the caret is sitting inside. */
export interface TemplateToken {
  /** Index of the opening `{{` in the field's text. */
  readonly start: number;
  /** What has been typed after the braces so far — the filter's needle. */
  readonly query: string;
}
