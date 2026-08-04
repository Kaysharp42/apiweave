/**
 * How much of the edge its state colour covers, and how it got there.
 *
 * The edge is drawn as two stacked paths: a resting one that is always there,
 * and a state-coloured overlay revealed by `stroke-dashoffset`. The phase says
 * where that overlay sits.
 *
 * - `resting` — overlay fully hidden. The edge is untraversed plumbing.
 * - `armed` — a short stub of colour at the source. The node upstream is
 *   working; control has not left it yet.
 * - `traversed` — overlay fully drawn. Control passed through. Arriving here
 *   from any other phase animates the reveal source→target, which is the
 *   traversal itself; mounting here directly (a finished run, reloaded) does
 *   not, because nothing travelled.
 */
export type EdgePhase = "resting" | "armed" | "traversed";
