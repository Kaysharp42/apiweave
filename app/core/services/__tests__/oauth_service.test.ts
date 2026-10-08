import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase, type InitializedDatabase } from "../../db"
import { EnvironmentRepository, SecretRepository, WorkspaceRepository } from "../../repositories"
import { LocalOwnerProvider } from "../../auth/LocalOwnerProvider"
import { LocalOnlySyncProvider } from "../../sync/LocalOnlySyncProvider"
import { ScopeResolver } from "../scope_resolver"
import { SecretService } from "../secret_service"
import { OAuthService, authorizeWithPkce } from "../oauth_service"
import { SafeHttp } from "../../runner/safe_http"
import { decodeStoredToken, pkceChallenge } from "../../runner/oauth"
import { startFakeOAuthServer, type FakeOAuthServer } from "../../runner/__tests__/oauth_fake_server"

/**
 * Plays the user's browser: reads the authorization request, then follows the
 * redirect back to the loopback listener the way the authorization server
 * would after a sign-in. `tamper` lets a test answer with something else.
 */
function fakeBrowser(tamper: (query: URLSearchParams) => URLSearchParams = (query) => query) {
  const opened: URL[] = []
  const pages: { status: number; html: string }[] = []
  const openExternal = async (url: string): Promise<void> => {
    const request = new URL(url)
    opened.push(request)
    const query = request.searchParams
    const callback = new URL(query.get("redirect_uri")!)
    const answer = tamper(new URLSearchParams({ code: "the-code", state: query.get("state")! }))
    callback.search = answer.toString()
    // Not awaited by the opener in real life either: the browser is another process.
    void fetch(callback).then(async (response) => pages.push({ status: response.status, html: await response.text() }))
  }
  return { opened, pages, openExternal }
}

describe("authorizeWithPkce", () => {
  let server: FakeOAuthServer
  beforeEach(async () => {
    server = await startFakeOAuthServer()
    server.tokenResponse = (_call, token) => ({
      status: 200,
      body: {
        access_token: token,
        expires_in: 3600,
        refresh_token: "refresh-1",
        id_token: `x.${Buffer.from(JSON.stringify({ email: "ada@example.com" })).toString("base64url")}.y`,
      },
    })
  })
  afterEach(async () => {
    await server.close()
  })

  const request = () => ({
    authorizationUrl: `${server.url}/authorize?prompt=consent`,
    tokenUrl: `${server.url}/token`,
    clientId: "public-client",
    clientAuth: "basic" as const,
    scope: "openid email",
  })

  it("signs in over a loopback redirect and exchanges the code with the PKCE verifier", async () => {
    const browser = fakeBrowser()
    const token = await authorizeWithPkce(new SafeHttp(), request(), { openExternal: browser.openExternal, now: () => 1_000 })

    const query = browser.opened[0]!.searchParams
    expect(Object.fromEntries(query)).toMatchObject({
      prompt: "consent",
      response_type: "code",
      client_id: "public-client",
      scope: "openid email",
      code_challenge_method: "S256",
    })
    expect(query.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    const form = server.tokenCalls[0]!.form
    expect(form.get("grant_type")).toBe("authorization_code")
    expect(form.get("code")).toBe("the-code")
    expect(form.get("redirect_uri")).toBe(query.get("redirect_uri"))
    expect(form.get("client_id")).toBe("public-client")
    expect(pkceChallenge(form.get("code_verifier")!)).toBe(query.get("code_challenge"))
    expect(token).toEqual({ accessToken: "tok-1-abcdef", expiresAt: 3_601_000, refreshToken: "refresh-1", authorizedAs: "ada@example.com" })
    expect(browser.pages[0]).toMatchObject({ status: 200 })

    // One callback, then the listener is gone.
    await expect(fetch(query.get("redirect_uri")!)).rejects.toThrow()
  })

  it("refuses a callback whose state does not match, without exchanging the code", async () => {
    const browser = fakeBrowser((answer) => {
      answer.set("state", "forged")
      return answer
    })
    await expect(
      authorizeWithPkce(new SafeHttp(), request(), { openExternal: browser.openExternal, now: () => 0 }),
    ).rejects.toThrow("OAuth 2.0: sign-in failed: the response did not match this sign-in (state mismatch)")
    expect(server.tokenCalls).toHaveLength(0)
  })

  it("reports a refused sign-in to the browser and to the caller", async () => {
    const browser = fakeBrowser((answer) => new URLSearchParams({ state: answer.get("state")!, error: "access_denied" }))
    await expect(
      authorizeWithPkce(new SafeHttp(), request(), { openExternal: browser.openExternal, now: () => 0 }),
    ).rejects.toThrow("OAuth 2.0: sign-in failed: the server refused it (access_denied)")
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(browser.pages[0]?.status).toBe(400)
    expect(browser.pages[0]?.html).not.toContain("<script")
  })

  it("gives up when no one signs in", async () => {
    await expect(
      authorizeWithPkce(new SafeHttp(), request(), { openExternal: async () => undefined, now: () => 0, timeoutMs: 50 }),
    ).rejects.toThrow("OAuth 2.0: sign-in timed out")
  })
})

describe("OAuthService", () => {
  let db: InitializedDatabase
  let server: FakeOAuthServer
  let secrets: SecretService
  let workspaceId: string
  let environmentId: string

  beforeEach(async () => {
    server = await startFakeOAuthServer()
    server.tokenResponse = (_call, token) => ({ status: 200, body: { access_token: token, expires_in: 3600, refresh_token: "refresh-1" } })
    db = initDatabase({ databasePath: ":memory:" })
    const workspaces = new WorkspaceRepository(db.kvStore)
    const environments = new EnvironmentRepository(db.kvStore)
    workspaceId = workspaces.create({ name: "W", slug: "w" }).workspaceId
    environmentId = environments.create({ workspaceId, name: "Staging", variables: { IDP: server.url } }).environmentId
    const scopes = new ScopeResolver({
      workspaceExists: (id) => workspaces.getById(id) !== undefined,
      environmentExists: (id) => environments.getById(id) !== undefined,
    })
    secrets = new SecretService(new SecretRepository(db.kvStore), new LocalOnlySyncProvider(), new LocalOwnerProvider(), scopes, environments, new Uint8Array(32))
  })
  afterEach(async () => {
    await server.close()
    db.close()
  })

  it("stores the token set sealed in the environment's secrets, reports its status, and clears it", async () => {
    const browser = fakeBrowser()
    const service = new OAuthService({
      http: new SafeHttp(),
      secrets,
      environments: new EnvironmentRepository(db.kvStore),
      openExternal: browser.openExternal,
      now: () => Date.parse("2026-01-01T00:00:00Z"),
    })
    const request = {
      workspaceId,
      environmentId,
      oauth2: {
        grantType: "authorization_code" as const,
        authorizationUrl: "{{env.IDP}}/authorize",
        tokenUrl: "{{env.IDP}}/token",
        clientId: "public-client",
        tokenSecret: "{{secrets.API_TOKEN}}",
      },
    }

    expect(await service.status(request)).toEqual({ stored: false, authorizedAs: null, expiresAt: null, hasRefreshToken: false })
    const status = await service.authorize(request)
    expect(status).toEqual({ stored: true, authorizedAs: null, expiresAt: "2026-01-01T01:00:00.000Z", hasRefreshToken: true })

    const chain = { workspaceId, environmentId }
    expect((await secrets.resolve(workspaceId, chain, "API_TOKEN"))?.resolvedScope).toBe("environment")
    const { plaintext } = await secrets.resolvePlaintext("API_TOKEN", chain)
    expect(decodeStoredToken(plaintext!).token).toMatchObject({ accessToken: "tok-1-abcdef", refreshToken: "refresh-1" })
    expect(await service.status(request)).toEqual(status)

    expect((await service.clear(request)).stored).toBe(false)
    expect(await secrets.resolve(workspaceId, chain, "API_TOKEN")).toBeNull()
  })

  it("refuses a client-credentials config and a missing token secret before opening a browser", async () => {
    const browser = fakeBrowser()
    const service = new OAuthService({ http: new SafeHttp(), secrets, environments: new EnvironmentRepository(db.kvStore), openExternal: browser.openExternal })
    const oauth2 = { grantType: "authorization_code" as const, authorizationUrl: `${server.url}/a`, tokenUrl: `${server.url}/token`, clientId: "c" }
    await expect(service.authorize({ workspaceId, environmentId: null, oauth2 })).rejects.toThrow("Choose the secret to store the token in")
    await expect(
      service.authorize({ workspaceId, environmentId: null, oauth2: { ...oauth2, grantType: "client_credentials", tokenSecret: "{{secrets.T}}" } }),
    ).rejects.toThrow("Get token is for the authorization code grant")
    expect(browser.opened).toHaveLength(0)
  })
})
