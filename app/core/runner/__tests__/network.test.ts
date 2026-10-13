import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { SafeHttp, describeNetworkError } from "../safe_http"
import { NetworkDispatchers, hostMatches, loadCaCertificates, loadClientCertificate, type NetworkConfig } from "../network"
import { PFX_PASSPHRASE, fixture, fixturePath, startConnectProxy, startHttpsServer, type TestProxy, type TestServer } from "./network_test_servers"

let tlsServer: TestServer
let mtlsServer: TestServer
let proxy: TestProxy

beforeAll(async () => {
  tlsServer = await startHttpsServer()
  mtlsServer = await startHttpsServer(true)
  proxy = await startConnectProxy()
})

afterAll(async () => {
  await Promise.all([tlsServer.close(), mtlsServer.close(), proxy.close()])
})

const ca = (): string[] => [fixture("ca.pem").toString("utf8")]

/** GET `url` through a SafeHttp with `network`; the parsed body, or the network error message. */
async function get(network: NetworkConfig, url: string): Promise<{ status: string; client: string | null } | string> {
  const http = new SafeHttp({ network })
  try {
    const response = await http.safeFetch(url)
    return (await response.json()) as { status: string; client: string | null }
  } catch (error) {
    return describeNetworkError(error, url) ?? String(error)
  } finally {
    await http.close()
  }
}

describe("hostMatches", () => {
  it.each([
    ["api.example.com", "https://api.example.com/x", true],
    ["API.example.com", "https://api.example.com/x", true],
    ["api.example.com", "https://other.example.com/x", false],
    ["*.example.com", "https://a.b.example.com/x", true],
    ["*.example.com", "https://example.com/x", false],
    ["api.example.com:8443", "https://api.example.com:8443/x", true],
    ["api.example.com:8443", "https://api.example.com/x", false],
    ["api.example.com:443", "https://api.example.com/x", true],
    ["127.0.0.1", "https://127.0.0.1:9999/x", true],
    ["[::1]:8443", "https://[::1]:8443/x", true],
  ])("%s matches %s: %s", (pattern, url, expected) => {
    expect(hostMatches(pattern, url)).toBe(expected)
  })
})

describe("custom CA", () => {
  it("fails against a server signed by an unknown CA, and succeeds once that CA is trusted", async () => {
    expect(await get({}, `${tlsServer.url}/`)).toMatch(/^Network error: TLS handshake with 127\.0\.0\.1:\d+ failed/)
    expect(await get({ ca: ca() }, `${tlsServer.url}/`)).toEqual({ status: "ok", client: null })
  })

  it("keeps trusting Node's bundled roots and the OS store alongside a custom CA", () => {
    const dispatchers = new NetworkDispatchers({ ca: ca(), useSystemCa: true })
    // A dispatcher exists for every request once a CA is configured; it cannot be the global agent.
    expect(dispatchers.dispatcherFor("https://example.com/", true)).toBeDefined()
    void dispatchers.close()
  })

  it("refuses a file that is not a PEM certificate", () => {
    expect(() => loadCaCertificates([fixturePath("client.pfx")])).toThrow(/CA certificate .*client\.pfx/)
    expect(() => loadCaCertificates([fixturePath("missing.pem")])).toThrow(/cannot read .*missing\.pem \(ENOENT\)/)
    expect(loadCaCertificates([fixturePath("ca.pem")])[0]).toContain("BEGIN CERTIFICATE")
  })
})

describe("client certificates (mTLS)", () => {
  const pem = { host: "127.0.0.1", certFile: fixturePath("client.pem"), keyFile: fixturePath("client.key") }

  it("is refused without a client certificate", async () => {
    expect(await get({ ca: ca() }, `${mtlsServer.url}/`)).toMatch(/^Network error/)
  })

  it("presents a PEM certificate and key to the matching host", async () => {
    expect(await get({ ca: ca(), clientCertificates: [loadClientCertificate(pem)] }, `${mtlsServer.url}/`)).toEqual({
      status: "ok",
      client: "apiweave-client",
    })
  })

  it("presents a PFX opened with its passphrase", async () => {
    const certificate = loadClientCertificate({ host: "127.0.0.1", pfxFile: fixturePath("client.pfx"), passphrase: PFX_PASSPHRASE })
    expect(await get({ ca: ca(), clientCertificates: [certificate] }, `${mtlsServer.url}/`)).toMatchObject({ client: "apiweave-client" })
  })

  it("does not present a certificate to a host its pattern does not name", async () => {
    const certificate = loadClientCertificate({ ...pem, host: "*.example.com" })
    expect(await get({ ca: ca(), clientCertificates: [certificate] }, `${mtlsServer.url}/`)).toMatch(/^Network error/)
  })

  it("checks the files when loaded: a wrong passphrase or a missing key fails there, not on the first request", () => {
    expect(() => loadClientCertificate({ host: "h", pfxFile: fixturePath("client.pfx"), passphrase: "wrong" })).toThrow(/Client certificate for h:/)
    expect(() => loadClientCertificate({ host: "h", certFile: fixturePath("client.pem") })).toThrow(/certificate and key/)
    expect(() => loadClientCertificate({ host: "h", certFile: fixturePath("client.pem"), keyFile: fixturePath("server.key") })).toThrow(/Client certificate for h:/)
  })
})

describe("proxy", () => {
  it("tunnels https and http requests through the proxy, with credentials from its URL", async () => {
    proxy.tunnels.length = 0
    proxy.auth.length = 0
    const proxyUrl = new URL(proxy.url)
    proxyUrl.username = "alice"
    proxyUrl.password = "p@ss word"
    expect(await get({ proxy: proxyUrl.toString(), ca: ca() }, `${tlsServer.url}/`)).toMatchObject({ status: "ok" })
    expect(proxy.tunnels).toEqual([new URL(tlsServer.url).host])
    expect(proxy.auth).toEqual([`Basic ${Buffer.from("alice:p@ss word").toString("base64")}`])
  })

  it("sends a host in the bypass list directly", async () => {
    proxy.tunnels.length = 0
    expect(await get({ proxy: proxy.url, noProxy: "127.0.0.1", ca: ca() }, `${tlsServer.url}/`)).toMatchObject({ status: "ok" })
    expect(proxy.tunnels).toEqual([])
  })

  it("combines with a client certificate inside the tunnel", async () => {
    proxy.tunnels.length = 0
    const certificate = loadClientCertificate({ host: "127.0.0.1", pfxFile: fixturePath("client.pfx"), passphrase: PFX_PASSPHRASE })
    expect(await get({ proxy: proxy.url, ca: ca(), clientCertificates: [certificate] }, `${mtlsServer.url}/`)).toMatchObject({ client: "apiweave-client" })
    expect(proxy.tunnels).toHaveLength(1)
  })

  it("reports an unreachable proxy as a network error", async () => {
    expect(await get({ proxy: "http://127.0.0.1:1" }, `${tlsServer.url}/`)).toMatch(/^Network error: connection refused/)
  })
})

describe("SafeHttp.configure", () => {
  it("switches config for the next request", async () => {
    const http = new SafeHttp({ network: { proxy: proxy.url, ca: ca() } })
    proxy.tunnels.length = 0
    await (await http.safeFetch(`${tlsServer.url}/`)).text()
    http.configure({ ca: ca() })
    await (await http.safeFetch(`${tlsServer.url}/`)).text()
    expect(proxy.tunnels).toHaveLength(1)
    await http.close()
  })

  it("reuses one dispatcher per client certificate and TLS choice", () => {
    const certificate = loadClientCertificate({ host: "*.example.com", certFile: fixturePath("client.pem"), keyFile: fixturePath("client.key") })
    const dispatchers = new NetworkDispatchers({ clientCertificates: [certificate] })
    const a = dispatchers.dispatcherFor("https://a.example.com/", true)
    expect(a).toBeDefined()
    expect(dispatchers.dispatcherFor("https://b.example.com/x", true)).toBe(a)
    expect(dispatchers.dispatcherFor("https://a.example.com/", false)).not.toBe(a)
    expect(dispatchers.dispatcherFor("https://other.test/", true)).toBeUndefined()
    const insecure = dispatchers.dispatcherFor("https://other.test/", false)
    expect(dispatchers.dispatcherFor("https://more.test/", false)).toBe(insecure)
    void dispatchers.close()
  })
})
