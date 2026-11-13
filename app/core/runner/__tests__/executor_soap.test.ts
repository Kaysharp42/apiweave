import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { WorkflowExecutor, type ExecutorOutput, type WorkflowGraph } from "../executor"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"

interface Received {
  readonly headers: Record<string, string | string[] | undefined>
  readonly body: string
}

const TEMPERATURE_ENVELOPE = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="urn:temperature">
  <soap:Body>
    <t:GetTemperatureResponse>
      <t:Total unit="C">-4.5</t:Total>
      <t:Place>Oslo</t:Place>
    </t:GetTemperatureResponse>
  </soap:Body>
</soap:Envelope>`

const FAULT_ENVELOPE = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <soap:Fault>
      <faultcode>soap:Server</faultcode>
      <faultstring>Station unavailable</faultstring>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>`

/** An in-process SOAP endpoint: it records the request and answers with `respond`. */
async function startSoapServer(respond: (received: Received) => { status: number; body: string }): Promise<{ server: Server; url: string; received: Received[] }> {
  const received: Received[] = []
  const server = createServer((request, response) => {
    let body = ""
    request.on("data", (chunk) => (body += chunk))
    request.on("end", () => {
      const entry = { headers: request.headers, body }
      received.push(entry)
      const answer = respond(entry)
      response.writeHead(answer.status, { "Content-Type": "text/xml; charset=utf-8" })
      response.end(answer.body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return { server, url: `http://127.0.0.1:${port}/soap`, received }
}

function makeExecutor(): WorkflowExecutor {
  const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xDEADBEEF")
  return new WorkflowExecutor({ clock, rng, http: new SafeHttp(), functions: new DynamicFunctions(clock, rng) })
}

function workflow(config: Record<string, unknown>, variables: Record<string, unknown> = {}): WorkflowGraph {
  const nodes: WorkflowGraph["nodes"] = [
    { nodeId: "start", type: "start" },
    { nodeId: "soap", type: "http-request", config: { method: "POST", ...config } },
    { nodeId: "end", type: "end" },
  ]
  return {
    variables,
    nodes,
    edges: [
      { edgeId: "e1", source: "start", target: "soap" },
      { edgeId: "e2", source: "soap", target: "end" },
    ],
  }
}

const resultOf = (output: ExecutorOutput): Record<string, unknown> =>
  output.results.find((result) => result.nodeId === "soap")! as unknown as Record<string, unknown>

describe("WorkflowExecutor — SOAP bodies", () => {
  let server: Server | undefined
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    server = undefined
  })

  it("sends a SOAP 1.1 envelope as text/xml with a quoted SOAPAction", async () => {
    const api = await startSoapServer(() => ({ status: 200, body: TEMPERATURE_ENVELOPE }))
    server = api.server
    const output = await makeExecutor().executeWorkflow(workflow({
      url: api.url,
      bodyType: "soap",
      soap: { version: "1.1", action: "urn:temperature/GetTemperature", envelope: '<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body/></soap:Envelope>' },
    }))
    expect(output.status).toBe("passed")
    expect(api.received[0]!.headers["content-type"]).toBe("text/xml; charset=utf-8")
    expect(api.received[0]!.headers["soapaction"]).toBe('"urn:temperature/GetTemperature"')
    expect(api.received[0]!.body).toContain("<soap:Envelope")
  })

  it("sends a SOAP 1.2 envelope as application/soap+xml with the action in the Content-Type", async () => {
    const api = await startSoapServer(() => ({ status: 200, body: TEMPERATURE_ENVELOPE }))
    server = api.server
    const output = await makeExecutor().executeWorkflow(workflow({
      url: api.url,
      bodyType: "soap",
      soap: { version: "1.2", action: "urn:temperature/GetTemperature", envelope: "<env:Envelope xmlns:env=\"http://www.w3.org/2003/05/soap-envelope\"><env:Body/></env:Envelope>" },
    }))
    expect(output.status).toBe("passed")
    expect(api.received[0]!.headers["content-type"]).toBe('application/soap+xml; charset=utf-8; action="urn:temperature/GetTemperature"')
    expect(api.received[0]!.headers["soapaction"]).toBeUndefined()
  })

  it("substitutes placeholders inside the envelope and reads the response with XPath extractors", async () => {
    const api = await startSoapServer(() => ({ status: 200, body: TEMPERATURE_ENVELOPE }))
    server = api.server
    const output = await makeExecutor().executeWorkflow(workflow({
      url: "{{variables.url}}",
      bodyType: "soap",
      soap: { envelope: '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><Place>{{variables.city}}</Place></soap:Body></soap:Envelope>' },
      extractors: {
        total: 'xpath://*[local-name()="Total"]/text()',
        place: "xpath://*[local-name()=\"Place\"]/text()",
        unit: 'xpath://*[local-name()="Total"]/@unit',
      },
    }, { url: api.url, city: "Oslo" }))
    expect(output.status).toBe("passed")
    expect(api.received[0]!.body).toContain("<Place>Oslo</Place>")
    expect(output.extractedVariables).toMatchObject({ total: "-4.5", place: "Oslo", unit: "C" })
    expect((resultOf(output)["response"] as Record<string, unknown>)["body"]).toBe(TEMPERATURE_ENVELOPE)
  })

  it("fails the node on a SOAP Fault, naming its code and reason, and exposes response.fault", async () => {
    const api = await startSoapServer(() => ({ status: 500, body: FAULT_ENVELOPE }))
    server = api.server
    const output = await makeExecutor().executeWorkflow(workflow({
      url: api.url,
      bodyType: "soap",
      soap: { envelope: "<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\"><soap:Body/></soap:Envelope>" },
    }))
    expect(output.status).toBe("failed")
    expect(resultOf(output)["error"]).toBe("SOAP Fault soap:Server: Station unavailable")
    expect((resultOf(output)["response"] as Record<string, unknown>)["fault"]).toEqual({ code: "soap:Server", reason: "Station unavailable" })
  })

  it("passes a fault the expectedStatus asks for, so a negative test can assert on it", async () => {
    const api = await startSoapServer(() => ({ status: 500, body: FAULT_ENVELOPE }))
    server = api.server
    const output = await makeExecutor().executeWorkflow(workflow({
      url: api.url,
      bodyType: "soap",
      expectedStatus: 500,
      soap: { envelope: "<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\"><soap:Body/></soap:Envelope>" },
      extractors: { reason: 'xpath://*[local-name()="faultstring"]/text()' },
    }))
    expect(output.status).toBe("passed")
    expect(output.extractedVariables["reason"]).toBe("Station unavailable")
  })

  it("does not treat a non-SOAP XML response as a fault", async () => {
    const api = await startSoapServer(() => ({ status: 200, body: '<?xml version="1.0"?><result><ok>true</ok></result>' }))
    server = api.server
    const output = await makeExecutor().executeWorkflow(workflow({
      url: api.url,
      bodyType: "soap",
      soap: { envelope: "<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\"><soap:Body/></soap:Envelope>" },
      extractors: { ok: 'xpath://ok/text()' },
    }))
    expect(output.status).toBe("passed")
    expect(output.extractedVariables["ok"]).toBe("true")
  })
})
