import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { HTTPNodeDataSchema } from "@shared/zod-schemas"
import { WorkflowExecutor, type ExecutorDeps, type WorkflowGraph } from "../executor"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { FixedClockProvider, SeededRandomProvider, type ClockProvider } from "../harness/providers"
import { decodeStoredToken, encodeStoredToken, pkceChallenge, type OAuthTokenCache } from "../oauth"
import { startFakeOAuthServer, type FakeOAuthServer } from "./oauth_fake_server"

const CLIENT_SECRET = "s3cret-client-value"

class MovableClock implements ClockProvider {
  public constructor(public ms: number) {}
  public now(): Date {
    return new Date(this.ms)
  }
  public isoNow(): string {
    return this.now().toISOString()
  }
}

function makeExecutor(overrides: Partial<ExecutorDeps> = {}): WorkflowExecutor {
  const clock = overrides.clock ?? new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xDEADBEEF")
  return new WorkflowExecutor({
    clock,
    rng,
    http: new SafeHttp(),
    functions: new DynamicFunctions(clock, rng),
    secrets: { CLIENT_SECRET },
    ...overrides,
  })
}

/** start → one http-request node per auth config given → end, in a line. */
function workflow(apiUrl: string, ...auths: Record<string, unknown>[]): WorkflowGraph {
  const nodes = auths.map((oauth2, index) => ({
    nodeId: `call${index}`,
    type: "http-request" as const,
    config: { method: "GET", url: apiUrl, auth: { type: "oauth2", oauth2 } },
  }))
  const ids = ["start", ...nodes.map((node) => node.nodeId), "end"]
  return {
    nodes: [{ nodeId: "start", type: "start" }, ...nodes, { nodeId: "end", type: "end" }],
    edges: ids.slice(1).map((target, index) => ({ edgeId: `e${index}`, source: ids[index]!, target })),
  }
}

describe("PKCE", () => {
  it("derives the S256 challenge of RFC 7636 Appendix B", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
  })
})

describe("OAuth 2.0 schema", () => {
  it("accepts a client secret only as a {{secrets.NAME}} reference", () => {
    const parse = (clientSecret: string) =>
      HTTPNodeDataSchema.safeParse({
        auth: { type: "oauth2", oauth2: { grantType: "client_credentials", tokenUrl: "x", clientId: "c", clientSecret } },
      }).success
    expect(parse("{{secrets.CLIENT_SECRET}}")).toBe(true)
    expect(parse("")).toBe(true)
    expect(parse("hunter2")).toBe(false)
    expect(parse("{{env.CLIENT_SECRET}}")).toBe(false)
    expect(parse("x{{secrets.CLIENT_SECRET}}")).toBe(false)
  })
})

describe("OAuth 2.0 client credentials", () => {
  let server: FakeOAuthServer
  beforeEach(async () => {
    server = await startFakeOAuthServer()
  })
  afterEach(async () => {
    await server.close()
  })

  const config = (overrides: Record<string, unknown> = {}) => ({
    grantType: "client_credentials",
    tokenUrl: `${server.url}/token`,
    clientId: "my client",
    clientSecret: "{{secrets.CLIENT_SECRET}}",
    scope: "read write",
    ...overrides,
  })

  it("authenticates with a Basic header by default and sends the token as a bearer", async () => {
    const output = await makeExecutor().executeWorkflow(workflow(`${server.url}/api`, config({ audience: "https://api" })))
    expect(output.status).toBe("passed")
    const call = server.tokenCalls[0]!
    expect(call.headers.authorization).toBe(`Basic ${Buffer.from(`my+client:${CLIENT_SECRET}`).toString("base64")}`)
    expect(Object.fromEntries(call.form)).toEqual({ grant_type: "client_credentials", scope: "read write", audience: "https://api" })
    expect(server.apiCalls).toEqual(["Bearer tok-1-abcdef"])
  })

  it("sends the client id and secret as body parameters when asked", async () => {
    await makeExecutor().executeWorkflow(workflow(`${server.url}/api`, config({ clientAuth: "body" })))
    const call = server.tokenCalls[0]!
    expect(call.headers.authorization).toBeUndefined()
    expect(call.form.get("client_id")).toBe("my client")
    expect(call.form.get("client_secret")).toBe(CLIENT_SECRET)
  })

  it("fetches one token for every node that shares it", async () => {
    const output = await makeExecutor().executeWorkflow(workflow(`${server.url}/api`, config(), config()))
    expect(output.status).toBe("passed")
    expect(server.tokenCalls).toHaveLength(1)
    expect(server.apiCalls).toEqual(["Bearer tok-1-abcdef", "Bearer tok-1-abcdef"])
  })

  it("fetches a new token once the cached one nears expiry", async () => {
    const clock = new MovableClock(Date.parse("2026-01-02T03:00:00Z"))
    const cache: OAuthTokenCache = new Map()
    await makeExecutor({ clock, oauthTokens: cache }).executeWorkflow(workflow(`${server.url}/api`, config()))
    clock.ms += 3_000_000 // 50 minutes: still fresh
    await makeExecutor({ clock, oauthTokens: cache }).executeWorkflow(workflow(`${server.url}/api`, config()))
    expect(server.tokenCalls).toHaveLength(1)
    clock.ms += 580_000 // within the skew of expires_in
    await makeExecutor({ clock, oauthTokens: cache }).executeWorkflow(workflow(`${server.url}/api`, config()))
    expect(server.tokenCalls).toHaveLength(2)
    expect(server.apiCalls.at(-1)).toBe("Bearer tok-2-abcdef")
  })

  it("retries once with a fresh token when the API answers 401", async () => {
    const cache: OAuthTokenCache = new Map()
    await makeExecutor({ oauthTokens: cache }).executeWorkflow(workflow(`${server.url}/api`, config()))
    server.revoked.add("tok-1-abcdef")
    const output = await makeExecutor({ oauthTokens: cache }).executeWorkflow(workflow(`${server.url}/api`, config()))
    expect(output.status).toBe("passed")
    expect(server.apiCalls).toEqual(["Bearer tok-1-abcdef", "Bearer tok-1-abcdef", "Bearer tok-2-abcdef"])
  })

  it("does not retry a second 401", async () => {
    server.tokenResponse = (_call, token) => {
      server.revoked.add(token)
      return { status: 200, body: { access_token: token, expires_in: 3600 } }
    }
    const output = await makeExecutor().executeWorkflow(workflow(`${server.url}/api`, config()))
    expect(output.status).toBe("failed")
    expect(server.tokenCalls).toHaveLength(2)
    expect(server.apiCalls).toHaveLength(2)
  })

  it("fails the node with the token endpoint's status and OAuth error code", async () => {
    server.tokenResponse = () => ({ status: 401, body: { error: "invalid_client", error_description: "bad secret" } })
    const output = await makeExecutor().executeWorkflow(workflow(`${server.url}/api`, config()))
    expect(output.status).toBe("failed")
    expect(output.results[0]?.error).toBe("OAuth 2.0 token request failed: HTTP 401 (invalid_client)")
    expect(server.apiCalls).toHaveLength(0)
  })

  it("names a client secret that did not resolve", async () => {
    const output = await makeExecutor({ secrets: {} }).executeWorkflow(workflow(`${server.url}/api`, config()))
    expect(output.results[0]?.error).toBe("OAuth 2.0: secret CLIENT_SECRET is not set")
    expect(server.tokenCalls).toHaveLength(0)
  })

  it("reports every token it uses for masking", async () => {
    const masked: string[] = []
    await makeExecutor({ maskValue: (value) => masked.push(value) }).executeWorkflow(workflow(`${server.url}/api`, config()))
    expect(masked).toContain("tok-1-abcdef")
  })
})

describe("OAuth 2.0 authorization code at run time", () => {
  let server: FakeOAuthServer
  beforeEach(async () => {
    server = await startFakeOAuthServer()
  })
  afterEach(async () => {
    await server.close()
  })

  const config = () => ({
    grantType: "authorization_code",
    authorizationUrl: `${server.url}/authorize`,
    tokenUrl: `${server.url}/token`,
    clientId: "public-client",
    tokenSecret: "{{secrets.API_TOKEN}}",
  })
  const now = Date.parse("2026-01-02T03:04:05.000Z")

  it("uses a stored token while it is fresh", async () => {
    server.tokenResponse = (_call, token) => ({ status: 200, body: { access_token: token } })
    await makeExecutor().executeWorkflow(workflow(`${server.url}/api`, { ...config(), grantType: "client_credentials", clientSecret: "{{secrets.CLIENT_SECRET}}" }))
    const stored = encodeStoredToken({ accessToken: "tok-1-abcdef", expiresAt: now + 3_600_000, refreshToken: "refresh-1" })
    const output = await makeExecutor({ secrets: { API_TOKEN: stored } }).executeWorkflow(workflow(`${server.url}/api`, config()))
    expect(output.status).toBe("passed")
    expect(server.tokenCalls).toHaveLength(1)
  })

  it("refreshes an expired token, rotates the refresh token, and writes the new set back", async () => {
    server.tokenResponse = (_call, token) => ({ status: 200, body: { access_token: token, expires_in: 600, refresh_token: "refresh-2" } })
    const stored = encodeStoredToken({ accessToken: "expired-token", expiresAt: now - 1000, refreshToken: "refresh-1", authorizedAs: "ada@example.com" })
    const saved: [string, string][] = []
    const output = await makeExecutor({
      secrets: { API_TOKEN: stored },
      saveSecret: async (name, value) => {
        saved.push([name, value])
      },
    }).executeWorkflow(workflow(`${server.url}/api`, config(), config()))
    expect(output.status).toBe("passed")
    // One refresh serves both nodes.
    expect(server.tokenCalls).toHaveLength(1)
    expect(Object.fromEntries(server.tokenCalls[0]!.form)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "refresh-1",
      client_id: "public-client",
    })
    expect(saved).toHaveLength(1)
    expect(saved[0]![0]).toBe("API_TOKEN")
    expect(decodeStoredToken(saved[0]![1])).toEqual({
      stored: true,
      token: { accessToken: "tok-1-abcdef", expiresAt: now + 600_000, refreshToken: "refresh-2", authorizedAs: "ada@example.com" },
    })
  })

  it("takes a bare refresh token (the CLI) and never writes over it", async () => {
    const saved: string[] = []
    const output = await makeExecutor({
      secrets: { API_TOKEN: "bare-refresh-token" },
      saveSecret: async (name) => {
        saved.push(name)
      },
    }).executeWorkflow(workflow(`${server.url}/api`, config()))
    expect(output.status).toBe("passed")
    expect(server.tokenCalls[0]!.form.get("refresh_token")).toBe("bare-refresh-token")
    expect(saved).toEqual([])
  })

  it("fails clearly when no token was ever fetched", async () => {
    const output = await makeExecutor().executeWorkflow(workflow(`${server.url}/api`, config()))
    expect(output.results[0]?.error).toMatch(/^OAuth 2\.0: no token in secret API_TOKEN\. Use Get token/)
    expect(server.tokenCalls).toHaveLength(0)
  })

  it("fails clearly when the token expired and there is no refresh token", async () => {
    const stored = encodeStoredToken({ accessToken: "expired-token", expiresAt: now - 1000 })
    const output = await makeExecutor({ secrets: { API_TOKEN: stored } }).executeWorkflow(workflow(`${server.url}/api`, config()))
    expect(output.results[0]?.error).toBe("OAuth 2.0: the token in secret API_TOKEN expired and has no refresh token. Use Get token again.")
  })
})
