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

/**
 * Finished project runs kept per project, pruned the same way as
 * {@link RUN_HISTORY_RETENTION_PER_WORKFLOW} each time one finishes. The
 * workflows' own runs follow their workflow's retention, not this one.
 *
 * ponytail: fixed knob, like the run retention above.
 */
export const PROJECT_RUN_HISTORY_RETENTION_PER_PROJECT = 50

/**
 * Workflow revisions (snapshots taken before a write replaces a workflow).
 * Canvas auto-saves every 700 ms of editing, so a canvas write is snapshotted
 * only when the newest snapshot is a canvas one older than this; any other
 * writer (an agent, cloud sync, an import, a restore) is always snapshotted
 * first. Each workflow keeps its newest {@link WORKFLOW_REVISIONS_KEPT}, none
 * older than {@link WORKFLOW_REVISION_MAX_AGE_MS}.
 *
 * ponytail: fixed knobs, like the run retention above.
 */
export const WORKFLOW_REVISION_INTERVAL_MS = 10 * 60 * 1000
export const WORKFLOW_REVISIONS_KEPT = 50
export const WORKFLOW_REVISION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000
