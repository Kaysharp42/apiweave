import type { WorkflowNode } from "@shared/types/WorkflowNode"
import type { NodeReferenceUse } from "@shared/types/NodeReferenceUse"
import { sanitizeUrlWithReferences } from "./secret_utils"
import { isSecretKey } from "@shared/credentials/credentials"

/**
 * Safe facts about one stored node: what it calls and which placeholder
 * references it reads or writes. Node search (`workflows.searchNodes`) and the
 * workspace map (`workspaces.map`) are both built from these, so the two can
 * never disagree about what a node uses.
 *
 * Only *names* leave this module — a reference name inside `{{…}}`, a variable
 * an extractor or script sets, a URL path with its query string, userinfo and
 * credential-looking segments removed. A literal value never matches a
 * reference pattern, so nothing here can surface a withheld secret.
 */

/** One placeholder reference a node uses, with where and how. */
export interface NodeReference extends NodeReferenceUse {
  /** `variables.token`, `env.BASE_URL`, `secrets.API_KEY`. */
  readonly ref: string
}

const PLACEHOLDER_REF_RE = /\{\{\s*(variables|env|secrets)\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g
// A script names what it reads or writes by literal: `aw.secrets.get("NAME")`,
// `aw.variables.set("NAME", …)`. The JSON-escaped quote form matches too, as in
// `scriptSecretNames`.
const SCRIPT_CALL_RE = /\baw\.(variables|env|secrets)\.(get|set)\(\s*\\?["'`]([A-Za-z_][A-Za-z0-9_]*)\\?["'`]/g

/** The `ref` filter grammar: a namespace and one name, nothing else. */
export const REFERENCE_FILTER_RE = /^(variables|env|secrets)\.[A-Za-z_][A-Za-z0-9_]*$/

/** Method and URL path of a request node; undefined for every other type. */
export function nodeEndpoint(node: WorkflowNode): { readonly method?: string; readonly urlPath: string } | undefined {
  if (node.type === "http-request") {
    const url = node.config?.url
    if (typeof url !== "string") return undefined
    const method = node.config?.method
    return typeof method === "string" ? { method, urlPath: urlPathTemplate(url) } : { urlPath: urlPathTemplate(url) }
  }
  if (node.type === "sse" || node.type === "websocket") {
    const url = node.config?.url
    return typeof url === "string" ? { method: "GET", urlPath: urlPathTemplate(url) } : undefined
  }
  if (node.type === "grpc") {
    const { service, method } = node.config ?? {}
    // The call's identity is its service and method: they stand where an HTTP node's path does.
    return typeof service === "string" && typeof method === "string" ? { method: "RPC", urlPath: `/${service}/${method}` } : undefined
  }
  return undefined
}

/**
 * The path portion of a URL template: the scheme and authority — or a leading
 * `{{…}}` base reference standing in for them — dropped, query string and
 * fragment dropped, other placeholders kept as written (they are references,
 * not values). The URL is passed through the shared reference-preserving
 * redactor first, so userinfo and credential-looking path segments are gone
 * before the path is cut out. Never throws on a URL the parser cannot read.
 */
export function urlPathTemplate(url: string): string {
  const redacted = sanitizeUrlWithReferences(url, "", isSecretKey)
  const withoutQuery = redacted.split(/[?#]/, 1)[0] ?? ""
  const path = withoutQuery
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "")
    .replace(/^\{\{[^{}]*\}\}(?=\/|$)/, "")
  return path === "" ? "/" : safeDecodeUri(path)
}

function safeDecodeUri(path: string): string {
  try {
    return decodeURI(path)
  } catch {
    return path
  }
}

/**
 * Every placeholder reference the node uses, deduplicated by (ref, field,
 * role). `field` is the config key it sits under (`url`, `headers`, `body`,
 * `auth`, `scripts`, `inputMapping`, …). Producers: extractor names,
 * `outputMapping` keys and `aw.variables.set`. Everything else consumes.
 */
export function nodeReferences(node: WorkflowNode): NodeReference[] {
  const config = node.config as Readonly<Record<string, unknown>> | undefined
  if (config === undefined) return []
  const found = new Map<string, NodeReference>()
  const add: AddReference = (ref, field, role) => {
    found.set(`${ref}\u0000${field}\u0000${role}`, { ref, field, role })
  }
  for (const [field, value] of Object.entries(config)) collectFieldReferences(field, value, add)
  return [...found.values()]
}

type AddReference = (ref: string, field: string, role: NodeReference["role"]) => void

function collectFieldReferences(field: string, value: unknown, add: AddReference): void {
  if (field === "extractors" || field === "outputMapping") {
    if (isRecord(value)) for (const name of Object.keys(value)) add(`variables.${name}`, field, "produces")
    return
  }
  if (field === "scripts") {
    forEachString(value, (text) => {
      for (const match of text.matchAll(SCRIPT_CALL_RE)) {
        add(`${match[1]}.${match[3]}`, field, match[2] === "set" ? "produces" : "consumes")
      }
    })
    return
  }
  if (field === "assertions") collectAssertionVariables(value, add)
  forEachString(value, (text) => {
    for (const match of text.matchAll(PLACEHOLDER_REF_RE)) add(`${match[1]}.${match[2]}`, field, "consumes")
  })
}

function collectAssertionVariables(value: unknown, add: AddReference): void {
  if (!Array.isArray(value)) return
  for (const item of value) {
    if (isRecord(item) && item["source"] === "variables" && typeof item["path"] === "string" && item["path"] !== "") {
      add(`variables.${item["path"]}`, "assertions", "consumes")
    }
  }
}

function forEachString(value: unknown, visit: (text: string) => void): void {
  if (typeof value === "string") {
    visit(value)
  } else if (Array.isArray(value)) {
    for (const item of value) forEachString(item, visit)
  } else if (isRecord(value)) {
    for (const child of Object.values(value)) forEachString(child, visit)
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
