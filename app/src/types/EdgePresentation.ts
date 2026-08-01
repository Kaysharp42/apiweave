/**
 * How a connection draws itself for a given run state.
 *
 * An edge takes its state from the node it leaves: idle plumbing is a hairline,
 * a live edge is the path the run is taking (DESIGN.md §7). Derived by
 * `presentationFor()` in `components/CustomEdge.tsx`.
 */
export interface EdgePresentation {
  stroke: string;
  strokeWidth: number;
  dash: string | undefined;
  /** Whether control is currently passing through this edge. */
  flowing: boolean;
}
