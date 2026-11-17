export interface UseBusyStepResult {
  /** A step is under way. */
  readonly busy: boolean;
  /** What the last step threw, until the next one starts. */
  readonly error: string | null;
  readonly setError: (error: string | null) => void;
  /** Run `step` as busy, clearing the error first; what it threw becomes `error`, and `fallback` is returned. */
  readonly runStep: <T>(step: () => Promise<T>, fallback: T) => Promise<T>;
}
