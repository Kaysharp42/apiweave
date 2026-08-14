/**
 * One node the run has shown the camera, and which branch it belongs to.
 *
 * `running` and `since` are what let attention decay continuously instead of
 * switching: a node still working holds its claim however long it takes, and a
 * finished one fades from the moment its result appeared. Nothing is dropped at
 * the instant it finishes, because that would move the aim in a single frame.
 */
export interface SeenRunNode {
  /** The front this node was attributed to when it was first shown. May have
   * since been absorbed, so it is always resolved before use. */
  readonly frontId: number;
  /** Still working, and so still worth watching regardless of age. */
  readonly running: boolean;
  /** When this last became news: it lit up, or its result appeared. */
  readonly since: number;
  /** Arrival order, so "the newest thing on this front" is answerable without
   * comparing timestamps that can tie at millisecond resolution. */
  readonly seq: number;
}
