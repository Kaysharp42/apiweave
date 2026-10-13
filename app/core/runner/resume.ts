import type { Run } from "@shared/types/Run"
import type { RunResult } from "@shared/types/RunResult"
import type { JsonValue } from "@shared/types/JsonValue"
import { SECRET_PLACEHOLDER } from "../services/secret_utils"
import type { WorkflowEdge, WorkflowNode } from "./executor"

/**
 * Rerunning part of a workflow ("Run from here", "Rerun failed branches").
 *
 * A rerun starts at one or more entry nodes and runs them and everything
 * downstream of them — its *scope*. Every node outside the scope keeps the
 * result it had in the source run: those results are seeded into the executor
 * so `{{prev...}}`, `{{<nodeId>...}}` and merge nodes resolve as they did, and
 * the variables the source run set are seeded so `{{variables.*}}` does too
 * (see {@link seedVariables}).
 *
 * Stored runs are masked: a secret's value, and any variable whose name or
 * value looks like a credential, is stored as `<SECRET>`. Such a variable is
 * never seeded, and a rerun whose nodes read one is refused (see
 * {@link maskedVariablesRead}); a seeded node result is checked as it is read
 * (the executor refuses a placeholder that resolves to masked or truncated
 * stored data). `{{secrets.*}}` are references and resolve fresh, as in any run.
 */

/** What the executor needs to resume: what runs, and what the source run already settled. */
export interface ResumeSeed {
  /** Entry nodes plus everything downstream of them: the nodes this run executes. */
  readonly scope: ReadonlySet<string>
  /** Results of nodes outside the scope, in their original completion order. */
  readonly results: readonly RunResult[]
  /** Source-run variables that were masked and so were not seeded. */
  readonly maskedVariables: readonly string[]
}

/** Every node reachable from `ids`, the ids themselves included. */
export function downstreamOf(edges: readonly WorkflowEdge[], ids: Iterable<string>): Set<string> {
  const reached = new Set<string>()
  const pending = [...ids]
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (reached.has(id)) continue
    reached.add(id)
    for (const edge of edges) if (edge.source === id) pending.push(edge.target)
  }
  return reached
}

/**
 * The entries no other entry reaches. Starting one that another entry reaches
 * would run it before its upstream had rerun; it runs anyway, in order, as part
 * of that entry's downstream.
 */
export function resumeEntries(edges: readonly WorkflowEdge[], ids: readonly string[]): string[] {
  const unique = [...new Set(ids)]
  return unique.filter((id) => !unique.some((other) => other !== id && downstreamOf(edges, [other]).has(id)))
}

/** True when a stored value was masked, wholly or in part. */
export function isMasked(value: unknown): boolean {
  return JSON.stringify(value)?.includes(SECRET_PLACEHOLDER) === true
}

/**
 * The source run's variables a rerun starts from, split into the ones it can
 * reuse and the names that were masked. A run stores every variable it ended
 * with, the workflow's own definitions included at their source-time values,
 * so a variable the current workflow defines is left to that definition —
 * an edit since the source run wins — unless a node outside the scope, which
 * the rerun does not execute, sets it.
 */
export function seedVariables(
  variables: Readonly<Record<string, JsonValue>>,
  defined: Readonly<Record<string, unknown>>,
  nodes: readonly WorkflowNode[],
  scope: ReadonlySet<string>,
): { readonly variables: Record<string, JsonValue>; readonly masked: string[] } {
  const setOutside = variablesWritten(nodes.filter((node) => !scope.has(node.nodeId)))
  const reusable: Record<string, JsonValue> = {}
  const masked: string[] = []
  for (const [name, value] of Object.entries(variables)) {
    if (name in defined && !setOutside.has(name)) continue
    if (isMasked(value)) masked.push(name)
    else reusable[name] = value
  }
  return { variables: reusable, masked }
}

const VARIABLE_READ = /\{\{\s*variables\.([^.}\s[]+)|aw\.variables\.get\(\s*["']([^"']+)["']/g
const SCRIPT_VARIABLE_WRITE = /aw\.variables\.set\(\s*["']([^"']+)["']/g

/**
 * The masked variables the scope's nodes read without setting them first in
 * the scope (an extractor, a Call Workflow output, or a script's
 * `aw.variables.set`). A rerun that needs one is refused: its stored value is
 * `<SECRET>`, never the value. A variable a scope node sets is left to the
 * executor, which refuses the read at run time if it still comes first.
 */
export function maskedVariablesRead(nodes: readonly WorkflowNode[], scope: ReadonlySet<string>, masked: readonly string[]): string[] {
  if (masked.length === 0) return []
  const inScope = nodes.filter((node) => scope.has(node.nodeId))
  const read = new Set<string>()
  for (const text of collectStrings(inScope.map((node) => node.config ?? {}))) {
    for (const match of text.matchAll(VARIABLE_READ)) read.add((match[1] ?? match[2])!)
  }
  const written = variablesWritten(inScope)
  return masked.filter((name) => read.has(name) && !written.has(name))
}

/** The variables `nodes` set: an extractor, a Call Workflow output, or a script's `aw.variables.set`. */
function variablesWritten(nodes: readonly WorkflowNode[]): Set<string> {
  const written = new Set<string>()
  for (const node of nodes) {
    const config = node.config ?? {}
    for (const key of ["extractors", "outputMapping"]) {
      const map = config[key]
      if (map !== null && typeof map === "object") for (const name of Object.keys(map)) written.add(name)
    }
    for (const text of collectStrings(config)) for (const match of text.matchAll(SCRIPT_VARIABLE_WRITE)) written.add(match[1]!)
  }
  return written
}

/**
 * Seeded results for a rerun whose scope is `scope`. `chain` is the source
 * run followed by the run it resumed, and so on: a rerun of a rerun still
 * needs the results its own source only inherited. Older results are laid
 * down first and each newer run replaces its own scope, so a node is never
 * seeded with a result its upstream has since replaced.
 */
export function seedResults(chain: readonly Run[], edges: readonly WorkflowEdge[], scope: ReadonlySet<string>): RunResult[] {
  const seeded = new Map<string, RunResult>()
  for (const run of [...chain].reverse()) {
    if (run.resumeFromNodeIds) for (const id of downstreamOf(edges, run.resumeFromNodeIds)) seeded.delete(id)
    for (const result of run.results) {
      if (result.status !== "passed" && result.status !== "failed") continue
      seeded.delete(result.nodeId) // re-inserted: completion order follows the newest run
      seeded.set(result.nodeId, result)
    }
  }
  return [...seeded.values()].filter((result) => !scope.has(result.nodeId))
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(collectStrings)
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(collectStrings)
  return []
}
