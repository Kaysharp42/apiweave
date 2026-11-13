import type { Document, Element } from "@xmldom/xmldom"
import { parseXmlDocument } from "@shared/extractors/xmlDocument"
import {
  chainEdges,
  makeEndNode,
  makeStartNode,
  positionForIndex,
  type HttpRequestNode,
  type ParsedWorkflow,
} from "./import_parsers"

/**
 * WSDL 1.1 import. Each SOAP operation becomes one HTTP Request node that
 * posts a SOAP envelope to the address its port declares, so an imported
 * WSDL runs the way the service describes it without hand-writing envelopes.
 *
 * Only what a run needs is read: the service ports and their `soap:address`
 * locations, each binding's operation actions, and the port type's operation
 * names. The schema types are not walked, so the generated envelope carries an
 * empty operation element rather than a field-per-argument skeleton; external
 * `wsdl:import` and `xsd:import` documents are not fetched.
 */

const WSDL_NS = "http://schemas.xmlsoap.org/wsdl/"
const SOAP11_BINDING_NS = "http://schemas.xmlsoap.org/wsdl/soap/"
const SOAP12_BINDING_NS = "http://schemas.xmlsoap.org/wsdl/soap12/"
const SOAP11_ENVELOPE_NS = "http://schemas.xmlsoap.org/soap/envelope/"
const SOAP12_ENVELOPE_NS = "http://www.w3.org/2003/05/soap-envelope"

export interface WsdlImportOptions {
  /** Overrides the address the WSDL declares (useful when it names an internal host). */
  readonly endpointUrl?: string
  /** Turns `http://` addresses into `https://` without touching the rest. */
  readonly forceHttps?: boolean
}

interface WsdlOperation {
  readonly name: string
  readonly action?: string
  readonly version: "1.1" | "1.2"
  readonly address: string
}

/** The unqualified local name of a QName attribute value (`tns:OrdersPortType` → `OrdersPortType`). */
function localNameOf(qname: string | null | undefined): string | undefined {
  if (!qname) return undefined
  const colon = qname.indexOf(":")
  return colon === -1 ? qname : qname.slice(colon + 1)
}

function childElements(parent: Element, localName: string): Element[] {
  const found: Element[] = []
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== 1) continue
    const element = child as Element
    if (element.localName === localName) found.push(element)
  }
  return found
}

function byName(parent: Element, localName: string): Element[] {
  return childElements(parent, localName)
}

/** The first child element in a SOAP binding namespace (1.1 first, then 1.2). */
function soapChild(parent: Element, localName: string): { readonly element: Element; readonly version: "1.1" | "1.2" } | undefined {
  for (const version of ["1.1", "1.2"] as const) {
    const namespace = version === "1.1" ? SOAP11_BINDING_NS : SOAP12_BINDING_NS
    const found = childElements(parent, localName).find((element) => element.namespaceURI === namespace)
    if (found) return { element: found, version }
  }
  return undefined
}

/** Every operation one port exposes, with the address its `soap:address` names. */
function operationsOf(document: Document): WsdlOperation[] {
  const definitions = document.documentElement
  if (!definitions || definitions.localName !== "definitions") return []

  // binding name → operation name → action, so a port's operations keep the
  // action its binding declared.
  const bindings = new Map<string, Map<string, string | undefined>>()
  for (const binding of byName(definitions, "binding")) {
    const name = binding.getAttribute("name")
    if (!name) continue
    const operations = new Map<string, string | undefined>()
    for (const operation of byName(binding, "operation")) {
      const operationName = operation.getAttribute("name")
      if (!operationName) continue
      operations.set(operationName, soapChild(operation, "operation")?.element.getAttribute("soapAction") ?? undefined)
    }
    bindings.set(name, operations)
  }

  const operations: WsdlOperation[] = []
  for (const service of byName(definitions, "service")) {
    for (const port of byName(service, "port")) {
      const address = soapChild(port, "address")
      const location = address?.element.getAttribute("location")
      const bindingName = localNameOf(port.getAttribute("binding"))
      if (!address || !location || !bindingName) continue
      for (const [operationName, action] of bindings.get(bindingName) ?? []) {
        operations.push({ name: operationName, address: location, version: address.version, ...(action ? { action } : {}) })
      }
    }
  }
  return operations
}

/** The SOAP envelope skeleton for an operation: an empty element in the WSDL's target namespace. */
function envelopeFor(version: "1.1" | "1.2", operationName: string, targetNamespace: string | undefined): string {
  const soapNamespace = version === "1.1" ? SOAP11_ENVELOPE_NS : SOAP12_ENVELOPE_NS
  const namespace = targetNamespace && targetNamespace !== "" ? targetNamespace : "urn:wsdl"
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<soap:Envelope xmlns:soap="${soapNamespace}">`,
    "  <soap:Body>",
    `    <tns:${operationName} xmlns:tns="${namespace}" />`,
    "  </soap:Body>",
    "</soap:Envelope>",
  ].join("\n")
}

/**
 * Parses a WSDL 1.1 document into a workflow: one POST per SOAP operation,
 * in the order the WSDL declares its services and bindings. Throws when the
 * text is not a WSDL document or declares no operation with an address.
 */
export function parseWsdlSpec(wsdlText: string, opts: WsdlImportOptions = {}): ParsedWorkflow {
  const document = parseXmlDocument(wsdlText)
  const definitions = document?.documentElement
  if (!document || !definitions || definitions.localName !== "definitions" || definitions.namespaceURI !== WSDL_NS) {
    throw new Error("Not a WSDL 1.1 document: expected a wsdl:definitions root")
  }
  const operations = operationsOf(document)
  if (operations.length === 0) {
    throw new Error("The WSDL declares no SOAP operation with a soap:address to call")
  }
  const targetNamespace = definitions.getAttribute("targetNamespace") ?? undefined
  const serviceName = byName(definitions, "service")[0]?.getAttribute("name") ?? "WSDL"

  const start = makeStartNode()
  const httpNodes: HttpRequestNode[] = operations.map((operation, index) => {
    const declared = opts.endpointUrl ?? operation.address
    const url = opts.forceHttps === true ? declared.replace(/^http:/, "https:") : declared
    return {
      nodeId: `http-${index + 1}`,
      type: "http-request",
      label: operation.name,
      position: positionForIndex(index),
      config: {
        method: "POST",
        url,
        headers: [],
        queryParams: [],
        cookies: [],
        bodyType: "soap",
        soap: {
          version: operation.version,
          ...(operation.action ? { action: operation.action } : {}),
          envelope: envelopeFor(operation.version, operation.name, targetNamespace),
        },
        timeout: 30,
        followRedirects: true,
        extractors: {},
      },
    }
  })
  const end = makeEndNode(httpNodes.length)
  return {
    name: serviceName,
    description: `Imported from WSDL: ${httpNodes.length} SOAP operation(s)`,
    nodes: [start, ...httpNodes, end],
    edges: chainEdges(start.nodeId, httpNodes.map((node) => node.nodeId), end.nodeId),
    variables: {},
    tags: [],
  }
}
