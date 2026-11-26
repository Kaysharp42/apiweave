import { unknownKeyError } from "./unknownKeyError"

const NODE_LEVEL = "belongs on the node, not in `config`."

const nodeConfigKeys = unknownKeyError({
  description: "Put text on the node `label` (only browser steps have a description).",
  label: `\`label\` ${NODE_LEVEL}`,
  position: `\`position\` ${NODE_LEVEL}`,
  parentId: `\`parentId\` ${NODE_LEVEL}`,
})

/** The public fields of a zod issue this function reads. */
export interface NodeConfigIssue {
  readonly code?: string | undefined
  readonly keys?: unknown
  readonly path?: readonly (string | number)[] | undefined
  readonly message: string
}

/**
 * An unknown key inside a node's `config` says where a node-level field
 * belongs; zod's own message only names the key. Applies to an
 * `unrecognized_keys` issue whose path is `[nodes | upsertNodes, index,
 * "config"]` (a browser step takes `description` itself, so it never reaches
 * here with it). Any other issue keeps its message, and a `nodeId "…": `
 * prefix a patch adds is kept in front.
 */
export function nodeConfigKeyMessage(issue: NodeConfigIssue): string {
  const path = issue.path ?? []
  const [list, index, field] = path
  const inNodeConfig =
    path.length === 3 && (list === "nodes" || list === "upsertNodes") && typeof index === "number" && field === "config"
  if (issue.code !== "unrecognized_keys" || !inNodeConfig) return issue.message
  const prefix = /^nodeId "[^"]*": /.exec(issue.message)?.[0] ?? ""
  return prefix + nodeConfigKeys({ code: issue.code, keys: issue.keys })
}
