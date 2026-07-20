import type { KVStore } from "./kvstore"
import type { SqliteRow } from "./sqlite-types"
import { canonicalizeWorkflowGraph } from "../repositories/helpers"

/**
 * One-shot in-place rewrite of every workflow's `graph_json`: any persisted
 * `http-request` node whose `headers` / `cookies` / `queryParams` /
 * `pathVariables` survived in a non-canonical shape (`string`,
 * `Record<string,string>`, or a non-conforming array) is rewritten to the
 * `KeyValuePair[]` form the strict `WorkflowNodeSchema` now mandates.
 *
 * Idempotent. {@link canonicalizeWorkflowGraph} returns the SAME graph when
 * no node drifted, so this walks every workflow row, rewrites only those
 * whose JSON shape actually changed, and stays cheap enough to run
 * unconditionally on every app startup (a workspace holds tens–hundreds of
 * workflows; reading their `graph_json` is sub-millisecond).
 *
 * Returns the number of workflow rows rewritten (useful for diagnostics;
 * the call site in `electron/main.ts` logs it once).
 */
export function canonicalizeExistingWorkflows(store: KVStore): number {
  interface WorkflowRow extends SqliteRow {
    readonly id: string
    readonly graph_json: string
  }

  const rows = store.query<WorkflowRow>("SELECT id, graph_json FROM workflows")
  if (rows.length === 0) return 0

  let touched = 0
  for (const row of rows) {
    let parsed: unknown
    try {
      parsed = JSON.parse(row.graph_json)
    } catch {
      // Skip rows whose graph_json is not parseable. These could not have
      // round-tripped through zod validation in the first place — they would
      // have been reported as HTTP-500 on read long before now. Leave them
      // alone rather than risk destroying their bytes.
      continue
    }

    const canonical = canonicalizeWorkflowGraph(parsed)
    if (canonical === parsed) continue

    store.set("UPDATE workflows SET graph_json = ? WHERE id = ?", [
      JSON.stringify(canonical),
      row.id,
    ])
    touched += 1
  }
  return touched
}