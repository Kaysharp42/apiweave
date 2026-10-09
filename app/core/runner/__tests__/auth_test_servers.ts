import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { signAwsSigV4 } from "../aws_sigv4"

/** Local servers that check a request's auth the way the real service would. */

export interface Received {
  readonly method: string
  readonly url: string
  readonly headers: IncomingMessage["headers"]
  readonly body: Buffer
}

export type Handler = (request: Received, response: ServerResponse) => void

export interface TestServer {
  readonly base: string
  readonly received: Received[]
  close(): Promise<void>
}

export async function startServer(handler: Handler): Promise<TestServer> {
  const received: Received[] = []
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => {
      const entry = { method: request.method ?? "", url: request.url ?? "", headers: request.headers, body: Buffer.concat(chunks) }
      received.push(entry)
      handler(entry, response)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

export const AWS_ACCESS_KEY_ID = "AKIDEXAMPLE"
export const AWS_SECRET = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY"

/**
 * Re-signs what arrived (region eu-west-1, service execute-api) with the same
 * algorithm and AWS_SECRET: 200 when the signatures match, 403 otherwise.
 */
export function verifyAwsSignature(request: Received, response: ServerResponse): void {
  const authorization = String(request.headers["authorization"] ?? "")
  const signedNames = /SignedHeaders=([^,]+)/.exec(authorization)?.[1]?.split(";") ?? []
  const headers: Record<string, string> = {}
  for (const name of signedNames) if (name !== "host") headers[name] = String(request.headers[name])
  const date = String(request.headers["x-amz-date"])
  const now = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`)
  const token = request.headers["x-amz-security-token"]
  const expected = signAwsSigV4(
    { method: request.method, url: `http://${request.headers["host"]}${request.url}`, headers, body: request.body, region: "eu-west-1", service: "execute-api", now },
    { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET, ...(typeof token === "string" ? { sessionToken: token } : {}) },
  )
  const ok = authorization !== "" && expected.headers["Authorization"] === authorization
  response.writeHead(ok ? 200 : 403, { "Content-Type": "application/json" }).end(JSON.stringify({ ok }))
}
