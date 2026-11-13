import * as xpath from "xpath"
import type { ExtractorResolution } from "../types/ExtractorResolution"
import { documentNamespaces, looksLikeXml, parseXmlDocument } from "./xmlDocument"

/**
 * XPath 1.0 path grammar: `xpath:<expression>`, evaluated against the response
 * body parsed as XML. Prefixes may be declared inline in square brackets,
 * `xpath[s=http://schemas.xmlsoap.org/soap/envelope/;t=urn:x]:<expression>`.
 * Prefixes the response document itself declares are bound automatically, an
 * inline declaration winning over the document's. XPath 1.0 has no default
 * namespace, so an unprefixed name never matches a namespaced element: bind a
 * prefix or match `*[local-name()='Name']`.
 */
const XPATH_RE = /^xpath(?:\[([^\]]*)\])?:([\s\S]*)$/

/** True when `path` is an XPath expression -- it begins with `xpath:` or `xpath[`. */
export function isXPath(path: string): boolean {
  return path.startsWith("xpath:") || path.startsWith("xpath[")
}

interface ParsedXPath {
  readonly expression: string
  readonly namespaces: Record<string, string>
}

function parseXPathPath(path: string): ParsedXPath | null {
  const match = XPATH_RE.exec(path)
  if (!match) return null
  const namespaces: Record<string, string> = {}
  for (const declaration of (match[1] ?? "").split(";")) {
    if (declaration.trim() === "") continue
    const equals = declaration.indexOf("=")
    const prefix = declaration.slice(0, equals).trim()
    const uri = declaration.slice(equals + 1).trim()
    if (equals < 1 || !/^[A-Za-z_][\w.-]*$/.test(prefix) || uri === "") return null
    namespaces[prefix] = uri
  }
  const expression = (match[2] ?? "").trim()
  return expression === "" ? null : { expression, namespaces }
}

/** True when `path` is a well-formed XPath path: a valid prefix block and an expression the parser accepts. */
export function isValidXPath(path: string): boolean {
  const parsed = parseXPathPath(path)
  if (!parsed) return false
  try {
    xpath.parse(parsed.expression)
    return true
  } catch {
    return false
  }
}

/** The XML text of a node result: `response.body` when it is a string, else `body`. */
function xmlTextOf(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined
  const record = data as Record<string, unknown>
  const response = record["response"]
  const candidates = [typeof response === "object" && response !== null ? (response as Record<string, unknown>)["body"] : undefined, record["body"]]
  return candidates.find((candidate): candidate is string => typeof candidate === "string")
}

function nodeText(node: Node): string {
  return node.nodeType === 2 ? (node as Attr).value : (node.textContent ?? "")
}

/**
 * Evaluates an XPath path against the XML in `data`. A node-set selecting one
 * node returns its text, several return an array of texts, and none is
 * `path-missing`; a number, string or boolean result (`count(...)`) is returned
 * as is. A body that is not well-formed XML, or holds a DTD, is `type-mismatch`.
 */
export function resolveXPath(data: unknown, path: string): ExtractorResolution {
  const parsed = parseXPathPath(path)
  if (!parsed) return { value: undefined, failureReason: "invalid-path" }
  const text = xmlTextOf(data)
  if (text === undefined || !looksLikeXml(text)) return { value: undefined, failureReason: "type-mismatch" }
  const document = parseXmlDocument(text)
  if (!document) return { value: undefined, failureReason: "type-mismatch" }

  let selected: xpath.SelectReturnType
  try {
    const namespaces = { ...documentNamespaces(document), ...parsed.namespaces }
    selected = xpath.parse(parsed.expression).evaluate({ node: document, namespaces }) as unknown as xpath.SelectReturnType
  } catch {
    return { value: undefined, failureReason: "invalid-path" }
  }
  return toResolution(selected)
}

function toResolution(selected: xpath.SelectReturnType): ExtractorResolution {
  if (Array.isArray(selected)) {
    if (selected.length === 0) return { value: undefined, failureReason: "path-missing" }
    return { value: selected.length === 1 ? nodeText(selected[0]!) : selected.map(nodeText), failureReason: null }
  }
  if (selected === null || selected === undefined) return { value: undefined, failureReason: "path-missing" }
  if (typeof selected === "object") return { value: nodeText(selected), failureReason: null }
  return { value: selected, failureReason: null }
}
