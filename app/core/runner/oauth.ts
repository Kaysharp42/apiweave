import { createHash, randomBytes } from "node:crypto"
import { describeNetworkError, type SafeHttp } from "./safe_http"
import { AuthError } from "./auth_error"

/**
 * OAuth 2.0 for HTTP nodes: the token endpoint client, the token cache, PKCE,
 * and the stored token-set format. Plain Node — the CLI runs this too.
 *
 * Every message an `OAuthError` carries starts with `OAuth 2.0` and names no
 * value: the scheduler passes such messages through to run history verbatim
 * (see `safeErrorClass`), so they may hold secret NAMES, hosts, HTTP statuses
 * and spec-defined OAuth error codes, never a token, a secret or a body.
 */
export class OAuthError extends AuthError {
  public override readonly name = "OAuthError"
}

/** A token is treated as expired this long before the server says it is. */
export const TOKEN_EXPIRY_SKEW_MS = 30_000

const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024
const OAUTH_ERROR_CODE = /^[\w.-]{1,64}$/

export interface OAuthToken {
  /** Empty when only a refresh token is known (a CLI-supplied refresh token). */
  readonly accessToken: string
  /** Epoch ms; null when the server gave no `expires_in`. */
  readonly expiresAt: number | null
  readonly refreshToken?: string
  /** Who the token was issued to, read from an OpenID `id_token`. Display only. */
  readonly authorizedAs?: string
}

/** Tokens by {@link tokenCacheKey}. One per app session (desktop) or process (CLI). */
export type OAuthTokenCache = Map<string, OAuthToken>

export function isTokenFresh(token: OAuthToken, now: number): boolean {
  return token.accessToken.length > 0 && (token.expiresAt === null || token.expiresAt - TOKEN_EXPIRY_SKEW_MS > now)
}

/** A hash, so the cache never holds the client secret or a stored token as a key. */
export function tokenCacheKey(parts: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex")
}

// -------------------- PKCE (RFC 7636) --------------------

/** 32 random bytes, base64url: a 43-character verifier. */
export function createPkceVerifier(): string {
  return randomBytes(32).toString("base64url")
}

/** The S256 code challenge for `verifier`. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url")
}

// -------------------- Token endpoint --------------------

export interface TokenRequest {
  readonly tokenUrl: string
  readonly clientId: string
  /** Absent for a public client: `client_id` then always goes in the body. */
  readonly clientSecret?: string
  readonly clientAuth: "basic" | "body"
  /** `grant_type` and the grant's own parameters. */
  readonly params: Readonly<Record<string, string>>
}

export interface TokenRequestOptions {
  readonly now: number
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  readonly rejectUnauthorized?: boolean
}

/**
 * POST a token request (RFC 6749 §4) and parse the answer. Redirects are not
 * followed: a 307 would resend a body that may carry the client secret.
 */
export async function requestToken(http: SafeHttp, request: TokenRequest, options: TokenRequestOptions): Promise<OAuthToken> {
  const body = new URLSearchParams(request.params)
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  }
  if (request.clientSecret !== undefined && request.clientAuth === "basic") {
    // RFC 6749 §2.3.1: each part is form-encoded before the base64.
    const credentials = `${formEncode(request.clientId)}:${formEncode(request.clientSecret)}`
    headers["Authorization"] = `Basic ${Buffer.from(credentials).toString("base64")}`
  } else {
    body.set("client_id", request.clientId)
    if (request.clientSecret !== undefined) body.set("client_secret", request.clientSecret)
  }

  let status: number
  let text: string
  try {
    http.validateUrl(request.tokenUrl)
    const response = await http.safeFetch(
      request.tokenUrl,
      { method: "POST", headers, body: body.toString(), ...(options.signal ? { signal: options.signal } : {}) },
      {
        followRedirects: false,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options.rejectUnauthorized === undefined ? {} : { rejectUnauthorized: options.rejectUnauthorized }),
      },
    )
    status = response.status
    text = (await http.readTextCapped(response, MAX_TOKEN_RESPONSE_BYTES)).text
  } catch (error) {
    const cause = options.signal?.aborted
      ? "cancelled"
      : error instanceof Error && error.name === "TimeoutError"
        ? "timed out"
        : error instanceof Error && error.name === "SafeUrlError"
          ? error.message
          : (describeNetworkError(error, request.tokenUrl) ?? "network error")
    throw new OAuthError(`OAuth 2.0 token request failed: ${cause}`)
  }

  const json = parseObject(text)
  if (status < 200 || status >= 300) {
    const code = json?.["error"]
    const suffix = typeof code === "string" && OAUTH_ERROR_CODE.test(code) ? ` (${code})` : ""
    throw new OAuthError(`OAuth 2.0 token request failed: HTTP ${status}${suffix}`)
  }
  const accessToken = json?.["access_token"]
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new OAuthError("OAuth 2.0 token response had no access_token")
  }
  const expiresIn = Number(json?.["expires_in"])
  const refreshToken = json?.["refresh_token"]
  const authorizedAs = idTokenSubject(json?.["id_token"])
  return {
    accessToken,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? options.now + expiresIn * 1000 : null,
    ...(typeof refreshToken === "string" && refreshToken.length > 0 ? { refreshToken } : {}),
    ...(authorizedAs ? { authorizedAs } : {}),
  }
}

function formEncode(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+")
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text)
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * The user an OpenID `id_token` names, for the "Authorized as" line. The
 * signature is not checked: nothing is decided on this, it is only shown.
 */
function idTokenSubject(idToken: unknown): string | undefined {
  if (typeof idToken !== "string") return undefined
  const claims = parseObject(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"))
  const name = claims?.["email"] ?? claims?.["preferred_username"] ?? claims?.["name"] ?? claims?.["sub"]
  return typeof name === "string" && name.length > 0 ? name.slice(0, 200) : undefined
}

// -------------------- Stored token set --------------------

/**
 * The value "Get token" seals into the secret store. A secret holding anything
 * else is read as a bare refresh token — which is how the CLI is given one.
 */
export function encodeStoredToken(token: OAuthToken): string {
  return JSON.stringify(token)
}

export function decodeStoredToken(value: string): { readonly token: OAuthToken; readonly stored: boolean } {
  const json = parseObject(value)
  if (json && typeof json["accessToken"] === "string") {
    const expiresAt = json["expiresAt"]
    const refreshToken = json["refreshToken"]
    const authorizedAs = json["authorizedAs"]
    return {
      stored: true,
      token: {
        accessToken: json["accessToken"],
        expiresAt: typeof expiresAt === "number" ? expiresAt : null,
        ...(typeof refreshToken === "string" ? { refreshToken } : {}),
        ...(typeof authorizedAs === "string" ? { authorizedAs } : {}),
      },
    }
  }
  return { stored: false, token: { accessToken: "", expiresAt: null, refreshToken: value.trim() } }
}

// -------------------- Runner --------------------

/** An `oauth2` auth config with its placeholders resolved. */
export interface ResolvedOAuth2 {
  readonly grantType: "client_credentials" | "authorization_code"
  readonly tokenUrl: string
  readonly clientId: string
  readonly clientSecret?: string
  readonly scope?: string
  readonly audience?: string
  readonly clientAuth: "basic" | "body"
  /** authorization_code: the secret holding the token set, and its value when it resolved. */
  readonly tokenSecretName?: string
  readonly storedToken?: string
}

export interface OAuthRunContext {
  readonly http: SafeHttp
  readonly cache: OAuthTokenCache
  readonly now: number
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  readonly rejectUnauthorized?: boolean
  /** Called with every token value the run sees, so the run's masker scrubs it. */
  readonly mask: (value: string) => void
  /** Write a refreshed token set back to the secret it was read from. */
  readonly save?: (secretName: string, value: string) => Promise<void>
}

/**
 * The access token to send for `config`: from the cache while fresh, else from
 * the token endpoint. `forceRefresh` skips the cache (a 401 answered the last one).
 */
export async function oauthAccessToken(config: ResolvedOAuth2, ctx: OAuthRunContext, forceRefresh: boolean): Promise<string> {
  const token = config.grantType === "client_credentials"
    ? await clientCredentialsToken(config, ctx, forceRefresh)
    : await authorizationCodeToken(config, ctx, forceRefresh)
  ctx.mask(token.accessToken)
  if (token.refreshToken) ctx.mask(token.refreshToken)
  return token.accessToken
}

async function clientCredentialsToken(config: ResolvedOAuth2, ctx: OAuthRunContext, forceRefresh: boolean): Promise<OAuthToken> {
  if (!config.clientSecret) {
    throw new OAuthError("OAuth 2.0: client credentials need a client secret set as {{secrets.NAME}}")
  }
  const key = tokenCacheKey(["client_credentials", config.tokenUrl, config.clientId, config.scope ?? "", config.audience ?? "", config.clientSecret])
  const cached = ctx.cache.get(key)
  if (cached && !forceRefresh && isTokenFresh(cached, ctx.now)) return cached
  const token = await requestToken(ctx.http, {
    tokenUrl: config.tokenUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    clientAuth: config.clientAuth,
    params: {
      grant_type: "client_credentials",
      ...(config.scope ? { scope: config.scope } : {}),
      ...(config.audience ? { audience: config.audience } : {}),
    },
  }, ctx)
  ctx.cache.set(key, token)
  return token
}

async function authorizationCodeToken(config: ResolvedOAuth2, ctx: OAuthRunContext, forceRefresh: boolean): Promise<OAuthToken> {
  const secretName = config.tokenSecretName
  if (!secretName) throw new OAuthError("OAuth 2.0: choose the secret that holds the token")
  if (config.storedToken === undefined || config.storedToken.trim().length === 0) {
    throw new OAuthError(
      `OAuth 2.0: no token in secret ${secretName}. Use Get token on the node's Auth tab; in the CLI, pass a refresh token as that secret.`,
    )
  }
  // Keyed by the stored value: within a run (and a session) a refreshed token
  // replaces the one it came from, and a newer value written back reads fresh.
  const key = tokenCacheKey(["authorization_code", config.storedToken])
  const decoded = decodeStoredToken(config.storedToken)
  ctx.mask(config.storedToken)
  const current = ctx.cache.get(key) ?? decoded.token
  if (!forceRefresh && isTokenFresh(current, ctx.now)) return current
  if (!current.refreshToken) {
    throw new OAuthError(`OAuth 2.0: the token in secret ${secretName} expired and has no refresh token. Use Get token again.`)
  }
  ctx.mask(current.refreshToken)
  const refreshed = await requestToken(ctx.http, {
    tokenUrl: config.tokenUrl,
    clientId: config.clientId,
    ...(config.clientSecret ? { clientSecret: config.clientSecret } : {}),
    clientAuth: config.clientAuth,
    params: {
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
      ...(config.scope ? { scope: config.scope } : {}),
    },
  }, ctx)
  // A server that does not rotate refresh tokens leaves the old one valid.
  const token: OAuthToken = {
    ...refreshed,
    refreshToken: refreshed.refreshToken ?? current.refreshToken,
    ...(refreshed.authorizedAs ?? current.authorizedAs ? { authorizedAs: refreshed.authorizedAs ?? current.authorizedAs } : {}),
  }
  ctx.cache.set(key, token)
  // Only a value "Get token" wrote is written back: a secret that held a bare
  // refresh token (or anything else) is never overwritten by a run.
  if (decoded.stored && ctx.save) {
    // ponytail: a failed write keeps the refreshed token in the session cache only.
    await ctx.save(secretName, encodeStoredToken(token)).catch(() => undefined)
  }
  return token
}
