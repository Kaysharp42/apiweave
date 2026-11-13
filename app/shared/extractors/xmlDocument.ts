import { DOMParser } from "@xmldom/xmldom"
import type { SoapFault } from "../types/SoapFault"

/** The largest XML text this module parses, a guard against pathological nesting. */
const MAX_XML_CHARS = 8 * 1024 * 1024

/**
 * A DOCTYPE is where every XML entity attack lives -- external entities (XXE),
 * and entity-expansion bombs ("billion laughs"). SOAP forbids a DTD in a
 * message (SOAP 1.1 section 3, SOAP 1.2 Part 1 section 5), so a document that
 * carries one is refused outright instead of being parsed with the dangerous
 * features switched off. `@xmldom/xmldom` never fetches an external entity, but
 * it does expand internal ones, which is why the declaration itself is the
 * thing to reject.
 */
const DOCTYPE_RE = /<!DOCTYPE|<!ENTITY/i

const SOAP_ENVELOPE_NAMESPACES: ReadonlySet<string> = new Set([
  "http://schemas.xmlsoap.org/soap/envelope/",
  "http://www.w3.org/2003/05/soap-envelope",
])

/** True when `text` looks like an XML document (starts, after whitespace, with `<`). */
export function looksLikeXml(text: string): boolean {
  return /^\s*<(?:\?xml|[A-Za-z_])/.test(text)
}

const cache = new Map<string, Document | null>()
const CACHE_LIMIT = 16

/**
 * Parses `text` as a namespace-aware XML document, or returns `null` when it
 * is not well-formed, holds a DTD, or is too large. Parsed documents are kept
 * in a small cache keyed by their text, so evaluating several extractors and
 * assertions against one response parses it once; the document itself is never
 * placed on a stored result.
 */
export function parseXmlDocument(text: string): Document | null {
  if (cache.has(text)) return cache.get(text) ?? null
  const document = parseUncached(text)
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  cache.set(text, document)
  return document
}

function parseUncached(text: string): Document | null {
  if (text.length > MAX_XML_CHARS || DOCTYPE_RE.test(text)) return null
  try {
    const document = new DOMParser({
      onError: (level, message) => {
        if (level !== "warning") throw new Error(message)
      },
    }).parseFromString(text, "text/xml")
    return document.documentElement ? document : null
  } catch {
    return null
  }
}

/** Every `xmlns:prefix` declaration in `document`, the first declaration of a prefix winning. */
export function documentNamespaces(document: Document): Record<string, string> {
  const namespaces: Record<string, string> = {}
  const visit = (element: Element): void => {
    for (let index = 0; index < element.attributes.length; index++) {
      const attribute = element.attributes.item(index)
      if (attribute?.prefix === "xmlns" && !(attribute.localName in namespaces)) {
        namespaces[attribute.localName] = attribute.value
      }
    }
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) visit(child as Element)
    }
  }
  if (document.documentElement) visit(document.documentElement)
  return namespaces
}

function childElements(element: Element, localName: string, namespaces: ReadonlySet<string>): Element[] {
  const found: Element[] = []
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== 1) continue
    const candidate = child as Element
    if (candidate.localName === localName && candidate.namespaceURI !== null && namespaces.has(candidate.namespaceURI)) {
      found.push(candidate)
    }
  }
  return found
}

function textOf(element: Element | undefined): string | undefined {
  return element?.textContent?.trim() || undefined
}

function firstByLocalName(parent: Element | undefined, localName: string): Element | undefined {
  if (!parent) return undefined
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && (child as Element).localName === localName) return child as Element
  }
  return undefined
}

/**
 * The SOAP Fault inside `text`, or `undefined` when it is not a SOAP envelope
 * or its body carries no fault. SOAP 1.1 spells the members `faultcode` and
 * `faultstring`; 1.2 spells them `Code/Value` and `Reason/Text`.
 */
export function findSoapFault(text: string): SoapFault | undefined {
  if (!looksLikeXml(text)) return undefined
  const document = parseXmlDocument(text)
  const root = document?.documentElement
  if (!root || root.localName !== "Envelope" || !root.namespaceURI || !SOAP_ENVELOPE_NAMESPACES.has(root.namespaceURI)) {
    return undefined
  }
  const envelopeNamespaces = new Set([root.namespaceURI])
  const fault = childElements(root, "Body", envelopeNamespaces).flatMap((body) => childElements(body, "Fault", envelopeNamespaces))[0]
  if (!fault) return undefined
  const code = textOf(firstByLocalName(fault, "faultcode")) ?? textOf(firstByLocalName(firstByLocalName(fault, "Code"), "Value"))
  const reason = textOf(firstByLocalName(fault, "faultstring")) ?? textOf(firstByLocalName(firstByLocalName(fault, "Reason"), "Text"))
  return { ...(code === undefined ? {} : { code }), ...(reason === undefined ? {} : { reason }) }
}
