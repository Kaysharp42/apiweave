/**
 * Node-response bodies at or above this size spill to the `run_responses`
 * side table instead of riding inline in the run row (decision #7). The
 * executor (Task 14) reuses this threshold when persisting results.
 *
 * ponytail: fixed 1 MiB knob; make it a user setting only if real workloads
 * need per-install tuning.
 */
export const SIDE_TABLE_THRESHOLD_BYTES = 1024 * 1024

/**
 * Finished runs kept per workflow. Every time a run of a workflow reaches a
 * terminal status, older finished runs beyond this count are deleted with
 * their node results and side-table bodies.
 *
 * ponytail: fixed knob; make it a user setting only if people ask for longer
 * history.
 */
export const RUN_HISTORY_RETENTION_PER_WORKFLOW = 100
