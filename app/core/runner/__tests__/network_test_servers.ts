import fs from "node:fs"
import http from "node:http"
import https from "node:https"
import net from "node:net"
import path from "node:path"
import type { AddressInfo } from "node:net"
import type { TLSSocket } from "node:tls"

/**
 * Local servers for the proxy / CA / mTLS tests. The certificates in
 * __fixtures__/tls are test-only, valid until 2126, made with openssl:
 * a CA ("APIWeave Test CA"), a server certificate for localhost/127.0.0.1 and
 * a client certificate ("apiweave-client", also as client.pfx with the
 * passphrase below), both signed by that CA.
 */
export const TLS_FIXTURES = path.join(__dirname, "__fixtures__", "tls")
export const fixturePath = (name: string): string => path.join(TLS_FIXTURES, name)
export const fixture = (name: string): Buffer => fs.readFileSync(fixturePath(name))
export const PFX_PASSPHRASE = "fixture-passphrase"

export interface TestServer {
  readonly url: string
  close(): Promise<void>
}

/**
 * An HTTPS server signed by the test CA, answering `{"status":"ok","client":<CN or null>}`.
 * With `requireClientCert` it refuses a handshake without a client certificate the CA signed.
 */
export async function startHttpsServer(requireClientCert = false): Promise<TestServer> {
  const server = https.createServer(
    {
      cert: fixture("server.pem"),
      key: fixture("server.key"),
      ...(requireClientCert ? { ca: fixture("ca.pem"), requestCert: true, rejectUnauthorized: true } : {}),
    },
    (request, response) => {
      const peer = (request.socket as TLSSocket).getPeerCertificate()
      const client = peer && "subject" in peer && peer.subject ? peer.subject.CN : null
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ok", client }))
    },
  )
  return listen(server, "https")
}

export interface TestProxy extends TestServer {
  /** `host:port` of every CONNECT, in order. */
  readonly tunnels: string[]
  /** The Proxy-Authorization header of every CONNECT ("" when absent). */
  readonly auth: string[]
}

/** A forward proxy that only tunnels (CONNECT), which is what undici's ProxyAgent uses for http and https. */
export async function startConnectProxy(): Promise<TestProxy> {
  const tunnels: string[] = []
  const auth: string[] = []
  const server = http.createServer((_request, response) => response.writeHead(405).end())
  server.on("connect", (request: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    tunnels.push(request.url ?? "")
    auth.push(request.headers["proxy-authorization"] ?? "")
    const [host, port] = (request.url ?? "").split(":")
    const upstream = net.connect(Number(port), host, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      upstream.write(head)
      upstream.pipe(client)
      client.pipe(upstream)
    })
    const end = (): void => {
      upstream.destroy()
      client.destroy()
    }
    upstream.on("error", end)
    client.on("error", end)
  })
  const base = await listen(server, "http")
  return { ...base, tunnels, auth }
}

async function listen(server: http.Server | https.Server, scheme: "http" | "https"): Promise<TestServer> {
  const sockets = new Set<net.Socket>()
  server.on("connection", (socket: net.Socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    url: `${scheme}://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      }),
  }
}
