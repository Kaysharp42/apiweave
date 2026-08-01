/**
 * Progress rail state for a running node.
 *
 * A number is a determinate fraction in `0..1`. `"indeterminate"` sweeps a
 * partial fill — activity without a known end. `null` renders no rail, which
 * is the correct state for a node that has finished.
 */
export type NodeProgress = number | "indeterminate" | null;
