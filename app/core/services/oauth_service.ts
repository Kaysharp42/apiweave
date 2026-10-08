import { randomBytes } from "node:crypto"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import type { JsonValue } from "@shared/types/JsonValue"
import type { OAuthTokenRequest } from "@shared/types/OAuthTokenRequest"
import type { OAuthTokenStatus } from "@shared/types/OAuthTokenStatus"
import { OAuth2AuthConfigSchema } from "@shared/zod-schemas/AuthConfigSchema"
import { NotFoundError, ValidationError } from "../ipc/errors"
import {
  OAuthError,
  createPkceVerifier,
  decodeStoredToken,
  encodeStoredToken,
  pkceChallenge,
  requestToken,
  type OAuthToken,
} from "../runner/oauth"
import type { SafeHttp } from "../runner/safe_http"
import type { SecretService } from "./secret_service"

/** RFC 8252 §7.3 loopback redirect: one callback, then the listener closes. */
export const SIGN_IN_TIMEOUT_MS = 5 * 60_000

const SECRET_REFERENCE = /^\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/

export interface AuthorizationCodeRequest {
  readonly authorizationUrl: string
  readonly tokenUrl: string
  readonly clientId: string
  readonly clientSecret?: string
  readonly clientAuth: "basic" | "body"
  readonly scope?: string
  readonly audience?: string
}

export interface AuthorizationCodeOptions {
  /** Opens the authorization URL in the user's browser. Injected: tests drive it themselves. */
  readonly openExternal: (url: string) => Promise<void>
  readonly now: () => number
  readonly timeoutMs?: number
}

/**
 * Authorization code with PKCE (RFC 7636) over a loopback redirect (RFC 8252):
 * listen on 127.0.0.1 on an ephemeral port, open the authorization URL, take
 * the first callback, check its `state`, and exchange the code with the
 * verifier. The listener closes after that one callback or the timeout.
 */
export async function authorizeWithPkce(
  http: SafeHttp,
  request: AuthorizationCodeRequest,
  options: AuthorizationCodeOptions,
): Promise<OAuthToken> {
  http.validateUrl(request.authorizationUrl)
  const verifier = createPkceVerifier()
  const state = randomBytes(16).toString("base64url")
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  try {
    const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`
    const authorizationUrl = new URL(request.authorizationUrl)
    const query = authorizationUrl.searchParams
    query.set("response_type", "code")
    query.set("client_id", request.clientId)
    query.set("redirect_uri", redirectUri)
    query.set("state", state)
    query.set("code_challenge", pkceChallenge(verifier))
    query.set("code_challenge_method", "S256")
    if (request.scope) query.set("scope", request.scope)
    if (request.audience) query.set("audience", request.audience)

    const callback = waitForCallback(server, state, options.timeoutMs ?? SIGN_IN_TIMEOUT_MS)
    await options.openExternal(authorizationUrl.toString())
    const code = await callback
    return await requestToken(http, {
      tokenUrl: request.tokenUrl,
      clientId: request.clientId,
      ...(request.clientSecret ? { clientSecret: request.clientSecret } : {}),
      clientAuth: request.clientAuth,
      params: { grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier },
    }, { now: options.now() })
  } finally {
    server.close()
    server.closeAllConnections()
  }
}

/** The authorization code from the first `/callback` request, once its state matches. */
function waitForCallback(server: Server, state: string, timeoutMs: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new OAuthError("OAuth 2.0: sign-in timed out. Use Get token to try again."))
    }, timeoutMs)
    let answered = false
    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1")
      if (url.pathname !== "/callback" || answered) {
        res.writeHead(404).end()
        return
      }
      answered = true
      clearTimeout(timer)
      const params = url.searchParams
      const error = params.get("error")
      const code = params.get("code")
      let failure: string | null = null
      if (params.get("state") !== state) failure = "the response did not match this sign-in (state mismatch)"
      else if (error !== null) failure = /^[\w.-]{1,64}$/.test(error) ? `the server refused it (${error})` : "the server refused it"
      else if (!code) failure = "the response carried no authorization code"
      res.writeHead(failure === null ? 200 : 400, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'",
      })
      res.end(callbackPage(failure === null ? "Signed in. You can close this tab and return to APIWeave." : `Sign-in failed: ${failure}.`))
      if (failure === null) resolve(code!)
      else reject(new OAuthError(`OAuth 2.0: sign-in failed: ${failure}`))
    })
  })
}

function callbackPage(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>APIWeave</title><p>${escapeHtml(message)}</p>`
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

export interface OAuthServiceDeps {
  readonly http: SafeHttp
  readonly secrets: Pick<SecretService, "resolve" | "resolvePlaintext" | "storePlaintext" | "delete">
  readonly environments: {
    getById(environmentId: string): { readonly workspaceId: string } | undefined
    resolveEffectiveVariables(environmentId: string): Record<string, JsonValue>
  }
  readonly openExternal: (url: string) => Promise<void>
  readonly now?: () => number
}

/**
 * The app side of authorization-code OAuth: Get token, the token's status, and
 * Clear token. The token set lives in the secret store under the node's
 * `tokenSecret`, sealed like any other secret — never in the workflow.
 */
export class OAuthService {
  private readonly now: () => number

  public constructor(private readonly deps: OAuthServiceDeps) {
    this.now = deps.now ?? Date.now
  }

  public async authorize(request: OAuthTokenRequest): Promise<OAuthTokenStatus> {
    const { config, chain, secretName } = this.parse(request)
    if (config.grantType !== "authorization_code") throw new ValidationError("Get token is for the authorization code grant")
    if (!config.authorizationUrl) throw new ValidationError("Set the authorization URL first")
    // Where the token goes: where the secret already lives, else the environment, else the workspace.
    const existing = await this.deps.secrets.resolve(request.workspaceId, chain, secretName)
    const fill = await this.placeholderFiller(request.environmentId, chain)
    const clientSecret = config.clientSecret ? await fill(config.clientSecret) : undefined
    const token = await authorizeWithPkce(this.deps.http, {
      authorizationUrl: await fill(config.authorizationUrl),
      tokenUrl: await fill(config.tokenUrl),
      clientId: await fill(config.clientId),
      ...(clientSecret ? { clientSecret } : {}),
      clientAuth: config.clientAuth ?? "basic",
      ...(config.scope ? { scope: await fill(config.scope) } : {}),
      ...(config.audience ? { audience: await fill(config.audience) } : {}),
    }, { openExternal: this.deps.openExternal, now: this.now })
    const scopeType = existing?.resolvedScope ?? (request.environmentId ? "environment" : "workspace")
    await this.deps.secrets.storePlaintext(request.workspaceId, {
      scopeType,
      scopeId: scopeType === "environment" ? request.environmentId! : request.workspaceId,
      name: secretName,
      value: encodeStoredToken(token),
      label: "OAuth 2.0 token",
    })
    return toStatus(token)
  }

  public async status(request: OAuthTokenRequest): Promise<OAuthTokenStatus> {
    const { chain, secretName } = this.parse(request)
    if (!(await this.deps.secrets.resolve(request.workspaceId, chain, secretName))) return toStatus(null)
    const { plaintext } = await this.deps.secrets.resolvePlaintext(secretName, chain)
    return toStatus(plaintext === null ? null : decodeStoredToken(plaintext).token)
  }

  public async clear(request: OAuthTokenRequest): Promise<OAuthTokenStatus> {
    const { chain, secretName } = this.parse(request)
    const existing = await this.deps.secrets.resolve(request.workspaceId, chain, secretName)
    if (existing) {
      await this.deps.secrets.delete(request.workspaceId, existing.resolvedScope, existing.metadata.scopeId, secretName)
    }
    return toStatus(null)
  }

  private parse(request: OAuthTokenRequest) {
    const config = OAuth2AuthConfigSchema.parse(request.oauth2)
    const secretName = SECRET_REFERENCE.exec(config.tokenSecret ?? "")?.[1]
    if (!secretName) throw new ValidationError("Choose the secret to store the token in")
    if (request.environmentId !== null && this.deps.environments.getById(request.environmentId)?.workspaceId !== request.workspaceId) {
      throw new NotFoundError(`environment ${request.environmentId} not found`)
    }
    const chain = { workspaceId: request.workspaceId, ...(request.environmentId ? { environmentId: request.environmentId } : {}) }
    return { config, chain, secretName }
  }

  /**
   * Get token runs outside a workflow run, so it fills only what does not
   * depend on one: `{{env.*}}` from the environment and `{{secrets.*}}` down
   * the same scope chain. Anything else is refused rather than sent as text.
   */
  private async placeholderFiller(
    environmentId: string | null,
    chain: { readonly workspaceId: string; readonly environmentId?: string },
  ): Promise<(text: string) => Promise<string>> {
    const env = environmentId ? this.deps.environments.resolveEffectiveVariables(environmentId) : {}
    return async (text) => {
      let filled = text.replace(/\{\{\s*env\.([A-Za-z0-9_.-]+)\s*\}\}/g, (match, name: string) => {
        const value = env[name]
        return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : match
      })
      const secretPattern = /\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g
      if (filled.replace(secretPattern, "").includes("{{")) {
        throw new OAuthError("OAuth 2.0: Get token fills only {{env.*}} and {{secrets.*}} placeholders")
      }
      for (const [match, name] of filled.matchAll(secretPattern)) {
        const { plaintext } = await this.deps.secrets.resolvePlaintext(name!, chain)
        if (plaintext === null) throw new OAuthError(`OAuth 2.0: secret ${name} is not set`)
        filled = filled.replace(match, () => plaintext)
      }
      return filled
    }
  }
}

function toStatus(token: OAuthToken | null): OAuthTokenStatus {
  return {
    stored: token !== null,
    authorizedAs: token?.authorizedAs ?? null,
    expiresAt: token?.expiresAt ? new Date(token.expiresAt).toISOString() : null,
    hasRefreshToken: Boolean(token?.refreshToken),
  }
}
