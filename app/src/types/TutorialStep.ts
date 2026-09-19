/** One ordered, actionable instruction inside a tutorial lesson. */
export interface TutorialStep {
  readonly title: string;
  readonly instruction: string;
  /** Optional extra context — a label to look for, a caveat, an example value. */
  readonly detail?: string;
}
