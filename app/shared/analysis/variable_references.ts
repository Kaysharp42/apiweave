import type { PlaceholderReference } from "../types/PlaceholderReference"
import type { ScriptReference } from "../types/ScriptReference"
import type { VariableProvenanceNode } from "../types/VariableProvenanceNode"
import type { VariableWrite } from "../types/VariableWrite"

/**
 * What a piece of node text reads and writes, by name. The graph analyzer
 * (`variable_source_missing`), node facts (search and the workspace map) and a
 * rerun's masked-variable check all ask this module, so they agree on what a
 * reference is.
 *
 * A placeholder names a root and may walk into it: `{{variables.case}}`,
 * `{{variables.case.title}}` and `{{variables.items[0].id}}` all read `case`
 * or `items`. A script names what it reads or writes by literal:
 * `aw.variables.set("token", …)`, `aw.secrets.get("API_KEY")`. The
 * JSON-escaped quote form (`\"NAME\"`) matches too, so a serialised config can
 * be scanned.
 */

/**
 * A `{{scope.name…}}` placeholder. Groups: scope, root name, the path after it
 * (dot keys and `[n]` indexes, the grammar `readDotPath` walks).
 */
export const PLACEHOLDER_REFERENCE_RE =
  /\{\{\s*(variables|env|secrets|data)\.([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z0-9_-]+|\[\d+\])*)\s*\}\}/g

const SCRIPT_CALL_RE = /\baw\.(variables|env|secrets)\.(get|set)\(\s*\\?["'`]([A-Za-z_][A-Za-z0-9_]*)\\?["'`]/g

/** Every `{{scope.name…}}` placeholder in `text`, in order. */
export function placeholderReferences(text: string): PlaceholderReference[] {
  return [...text.matchAll(PLACEHOLDER_REFERENCE_RE)].map((match) => ({
    scope: match[1] as PlaceholderReference["scope"],
    name: match[2]!,
    path: match[3] ?? "",
  }))
}

/** Every literal-named `aw.<scope>.get`/`set` call in script `text`, in order. */
export function scriptReferences(text: string): ScriptReference[] {
  return [...text.matchAll(SCRIPT_CALL_RE)].map((match) => ({
    scope: match[1] as ScriptReference["scope"],
    name: match[3]!,
    write: match[2] === "set",
  }))
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Every workflow variable `node` sets: its extractors, a Call Workflow's
 * `outputMapping`, a browser `extract` step's `variable`, and each
 * `aw.variables.set("NAME", …)` in its scripts. The analyzer's producers, the
 * node facts' `produces` and a rerun's "set in scope" all come from here.
 */
export function variableWrites(node: VariableProvenanceNode): VariableWrite[] {
  const config = node.config
  if (config === undefined) return []
  const writes: VariableWrite[] = []
  const extractors = config["extractors"]
  if (isRecord(extractors)) {
    for (const [name, path] of Object.entries(extractors)) if (typeof path === "string") writes.push({ name, field: "extractors", path })
  }
  // A Call Workflow node copies each child variable into the caller's scope.
  const outputMapping = config["outputMapping"]
  if (node.type === "workflow" && isRecord(outputMapping)) {
    for (const [name, path] of Object.entries(outputMapping)) if (typeof path === "string") writes.push({ name, field: "outputMapping", path })
  }
  if (node.type === "browser" && config["action"] === "extract" && typeof config["variable"] === "string") {
    const from = typeof config["from"] === "string" ? config["from"] : "text"
    const path = from === "attribute" && typeof config["attribute"] === "string" ? `page.attribute.${config["attribute"]}` : `page.${from}`
    writes.push({ name: config["variable"], field: "variable", path })
  }
  const scripts = config["scripts"]
  if (isRecord(scripts)) {
    // A node whose scripts set a variable several times is still one producer
    // of it, named by the first script that does.
    const phases = new Map<string, string>()
    for (const [phase, source] of Object.entries(scripts)) {
      if (typeof source !== "string") continue
      for (const ref of scriptReferences(source)) if (ref.scope === "variables" && ref.write && !phases.has(ref.name)) phases.set(ref.name, phase)
    }
    for (const [name, phase] of phases) writes.push({ name, field: "scripts", path: `scripts.${phase}` })
  }
  return writes
}

/**
 * The variables a Call Workflow node among `callerNodes` passes into the
 * workflow `targetWorkflowId`: its `inputMapping` keys and its `forEach`
 * `itemVariable` and `indexVariable`. The called workflow reads these without
 * producing them, so its analysis counts them as set.
 */
export function callerSuppliedVariableNames(callerNodes: readonly VariableProvenanceNode[], targetWorkflowId: string): string[] {
  const names = new Set<string>()
  for (const node of callerNodes) {
    const config = node.config
    if (node.type !== "workflow" || config === undefined || config["targetWorkflowId"] !== targetWorkflowId) continue
    const inputMapping = config["inputMapping"]
    if (isRecord(inputMapping)) for (const name of Object.keys(inputMapping)) names.add(name)
    const forEach = config["forEach"]
    if (isRecord(forEach)) {
      for (const key of ["itemVariable", "indexVariable"]) {
        const name = forEach[key]
        if (typeof name === "string" && name !== "") names.add(name)
      }
    }
  }
  return [...names].sort()
}
