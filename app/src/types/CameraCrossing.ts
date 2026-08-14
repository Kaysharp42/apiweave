/**
 * A handoff in flight: the camera is on its way from one branch to another.
 *
 * Two branches of a large workflow can be forty columns apart, which at a
 * readable zoom is several screens of empty canvas. Sliding across it conveys
 * nothing and takes seconds; teleporting across it is the strobe this model was
 * written to remove. So a long handoff is a crane move instead — pull back until
 * the whole trip is one glance, cross, push back in — and this is the state that
 * makes it one continuous move rather than three animations in a row.
 *
 * The working zoom is deliberately *not* stored here: it is left untouched on the
 * motion for the duration, so the push-in lands on exactly the zoom the run was
 * being watched at and a handoff can never ratchet the run's framing.
 */
export interface CameraCrossing {
  /** The zoom held while crossing: wide enough that the trip spans well under a
   * screen, so the destination is in view before the camera sets off. */
  readonly zoom: number;
  /** How close, in flow units, the camera has to get before the push back in
   * begins. Fixed when the move is planned so that arriving is a distance rather
   * than a duration — a slow frame makes it late, never wrong. */
  readonly settleWithin: number;
}
