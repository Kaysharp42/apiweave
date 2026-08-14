/**
 * One thing the camera knows about, in flow coordinates.
 *
 * `running` and `since` are what let attention decay continuously instead of
 * switching: a node still working holds full attention however long it takes,
 * and a finished one fades from the moment its result appeared. Nothing is ever
 * removed at the instant it finishes, because that would move the camera's aim
 * in a single frame.
 */
export interface AttentionPoint {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Still working, and so still worth watching regardless of age. */
  readonly running: boolean;
  /** When this last became news: it lit up, or its result appeared. */
  readonly since: number;
}
