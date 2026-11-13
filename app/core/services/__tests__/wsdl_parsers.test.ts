import { describe, expect, it } from "vitest"
import { parseWsdlSpec } from "../wsdl_parsers"
import type { HttpRequestNode } from "../import_parsers"

const WSDL_11 = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"
             xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
             xmlns:tns="urn:orders"
             targetNamespace="urn:orders">
  <portType name="OrdersPortType">
    <operation name="GetOrder"><input message="tns:GetOrderInput"/></operation>
    <operation name="CancelOrder"><input message="tns:CancelOrderInput"/></operation>
  </portType>
  <binding name="OrdersBinding" type="tns:OrdersPortType">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="GetOrder">
      <soap:operation soapAction="urn:orders/GetOrder"/>
    </operation>
    <operation name="CancelOrder">
      <soap:operation soapAction="urn:orders/CancelOrder"/>
    </operation>
  </binding>
  <service name="OrdersService">
    <port name="OrdersPort" binding="tns:OrdersBinding">
      <soap:address location="http://orders.example.test/soap"/>
    </port>
  </service>
</definitions>`

const WSDL_12 = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"
             xmlns:soap12="http://schemas.xmlsoap.org/wsdl/soap12/"
             xmlns:tns="urn:temp"
             targetNamespace="urn:temp">
  <binding name="TempBinding">
    <soap12:binding transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="Read">
      <soap12:operation soapAction="urn:temp/Read"/>
    </operation>
  </binding>
  <service name="TempService">
    <port name="TempPort" binding="tns:TempBinding">
      <soap12:address location="https://temp.example.test/soap"/>
    </port>
  </service>
</definitions>`

const httpNodesOf = (wsdl: string): HttpRequestNode[] =>
  parseWsdlSpec(wsdl).nodes.filter((node): node is HttpRequestNode => node.type === "http-request")

describe("parseWsdlSpec", () => {
  it("creates one POST per operation, addressed from the port's soap:address", () => {
    const workflow = parseWsdlSpec(WSDL_11)
    const nodes = httpNodesOf(WSDL_11)
    expect(workflow.name).toBe("OrdersService")
    expect(nodes.map((node) => node.label)).toEqual(["GetOrder", "CancelOrder"])
    expect(nodes[0]!.config).toMatchObject({ method: "POST", url: "http://orders.example.test/soap", bodyType: "soap", soap: { version: "1.1", action: "urn:orders/GetOrder" } })
    expect(nodes[0]!.config.body).toBeUndefined()
    expect(workflow.nodes.map((node) => node.type)).toEqual(["start", "http-request", "http-request", "end"])
    expect(workflow.edges).toHaveLength(3)
  })

  it("fills the envelope with the operation name and the WSDL target namespace", () => {
    const envelope = httpNodesOf(WSDL_11)[0]!.config.soap!.envelope
    expect(envelope).toContain("http://schemas.xmlsoap.org/soap/envelope/")
    expect(envelope).toContain("<tns:GetOrder")
    expect(envelope).toContain('xmlns:tns="urn:orders"')
  })

  it("reads a SOAP 1.2 address and uses the 1.2 envelope namespace", () => {
    const node = httpNodesOf(WSDL_12)[0]!
    expect(node.config.soap).toMatchObject({ version: "1.2", action: "urn:temp/Read" })
    expect(node.config.soap!.envelope).toContain("http://www.w3.org/2003/05/soap-envelope")
  })

  it("applies an endpoint override and can force https", () => {
    const urlOf = (options: Parameters<typeof parseWsdlSpec>[1]): string =>
      (parseWsdlSpec(WSDL_11, options).nodes.find((node) => node.type === "http-request") as HttpRequestNode).config.url
    expect(urlOf({ endpointUrl: "https://staging.example.test/soap" })).toBe("https://staging.example.test/soap")
    expect(urlOf({ forceHttps: true })).toBe("https://orders.example.test/soap")
  })

  it("rejects a document that is not a WSDL, a WSDL without operations, and a DTD", () => {
    expect(() => parseWsdlSpec("<note><to>x</to></note>")).toThrow(/Not a WSDL/)
    expect(() => parseWsdlSpec('<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"/>')).toThrow(/no SOAP operation/)
    expect(() => parseWsdlSpec(`<!DOCTYPE definitions [<!ENTITY x "y">]>${WSDL_11}`)).toThrow(/Not a WSDL/)
  })
})
