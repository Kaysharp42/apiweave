import http from "node:http"
import type { AddressInfo } from "node:net"
import type { McpHttpFixtureServer } from "./types"

/**
 * Starts the deterministic loopback HTTP dependency used by task trials. Its
 * responses contain synthetic data only and never proxy a real API.
 */
export async function startMcpBenchmarkHttpFixtureServer(): Promise<McpHttpFixtureServer> {
// fallow-ignore-next-line complexity
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (url.pathname === "/orders/expected-conflict") {
      return respond(response, 409, { code: "ORDER_CONFLICT", message: "The requested order is already closed." })
    }
    if (url.pathname === "/orders/failure") {
      return respond(response, 500, { code: "ORDER_SERVICE_UNAVAILABLE", message: "Synthetic failure fixture." })
    }
    if (url.pathname === "/orders/truncated") {
      return respond(response, 200, { items: Array.from({ length: 256 }, (_, index) => ({ id: index, value: "fixture" })) })
    }
    if (url.pathname === "/orders/delayed") {
      const delayMs = Number(url.searchParams.get("delayMs") ?? "0")
      const boundedDelayMs = Number.isInteger(delayMs) && delayMs >= 0 && delayMs <= 60_000 ? delayMs : 0
      setTimeout(() => respond(response, 200, { status: "completed", delayMs: boundedDelayMs }), boundedDelayMs)
      return
    }
    respond(response, 404, { code: "FIXTURE_NOT_FOUND" })
  })
  await listen(server)
  const address = server.address()
  if (!isAddressInfo(address)) {
    await closeServer(server)
    throw new Error("MCP benchmark HTTP fixture server did not bind a TCP address")
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  }
}

function respond(response: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text, "utf8") })
  response.end(text)
}

function listen(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject)
      resolve()
    })
  })
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error))
  })
}

function isAddressInfo(address: string | AddressInfo | null): address is AddressInfo {
  return address !== null && typeof address !== "string"
}
