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
// fallow-ignore-next-line code-duplication -- the `[...matchAll].map` shape it shares with placeholderReferences is the whole of each scanner; the regex and the record built from the groups differ.
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
  return [
    ...mappedWrites(config["extractors"], "extractors"),
    // A Call Workflow node copies each child variable into the caller's scope.
    ...(node.type === "workflow" ? mappedWrites(config["outputMapping"], "outputMapping") : []),
    ...(node.type === "browser" ? browserExtractWrites(config) : []),
    ...scriptWrites(config["scripts"]),
  ]
}

/** One write per `name: path` entry of an `extractors` or `outputMapping` record. */
function mappedWrites(mapping: unknown, field: "extractors" | "outputMapping"): VariableWrite[] {
  if (!isRecord(mapping)) return []
  return Object.entries(mapping).flatMap(([name, path]) => (typeof path === "string" ? [{ name, field, path }] : []))
}

/** A browser `extract` step's `variable`, with the page part it reads as its path. */
function browserExtractWrites(config: Readonly<Record<string, unknown>>): VariableWrite[] {
  const variable = config["variable"]
  if (config["action"] !== "extract" || typeof variable !== "string") return []
  const from = typeof config["from"] === "string" ? config["from"] : "text"
  const attribute = config["attribute"]
  const path = from === "attribute" && typeof attribute === "string" ? `page.attribute.${attribute}` : `page.${from}`
  return [{ name: variable, field: "variable", path }]
}

/**
 * Each variable a node's scripts set. A node whose scripts set a variable
 * several times is still one producer of it, named by the first script that does.
 */
function scriptWrites(scripts: unknown): VariableWrite[] {
  if (!isRecord(scripts)) return []
  const phases = new Map<string, string>()
  for (const [phase, source] of Object.entries(scripts)) {
    if (typeof source !== "string") continue
    for (const ref of scriptReferences(source)) if (ref.scope === "variables" && ref.write && !phases.has(ref.name)) phases.set(ref.name, phase)
  }
  return [...phases].map(([name, phase]) => ({ name, field: "scripts", path: `scripts.${phase}` }))
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
    for (const name of suppliedVariableNames(config)) names.add(name)
  }
  return [...names].sort()
}

/** One Call Workflow node's `inputMapping` keys and non-empty `forEach` item/index variables. */
function suppliedVariableNames(config: Readonly<Record<string, unknown>>): string[] {
  const inputMapping = config["inputMapping"]
  const forEach = config["forEach"]
  const loopVariables = isRecord(forEach) ? [forEach["itemVariable"], forEach["indexVariable"]] : []
  return [
    ...(isRecord(inputMapping) ? Object.keys(inputMapping) : []),
    ...loopVariables.filter((name): name is string => typeof name === "string" && name !== ""),
  ]
}
