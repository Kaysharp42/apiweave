import type { CookieJar } from "tough-cookie"
import { Headers, fetch, type RequestInit, type Response } from "undici"
import { NetworkDispatchers, type NetworkConfig } from "./network"

/**
 * The outbound HTTP client for the runner (HTTP request nodes) and URL imports.
 *
 * APIWeave is a desktop user agent: it sends the request the user authored,
 * wherever they pointed it — localhost, a LAN box, anything. There is no
 * network policy to configure, the same way there is none in Postman or curl.
 * A target blocklist belongs to a *server-side* runner, where an attacker
 * supplies the URL; here the user owns the machine, the workflow and a shell,
 * so a blocklist only ever blocked the user from their own dev services.
 *
 * What this class still does is protect the *process* from a remote endpoint:
 * http(s) only, a deadline that keeps enforcing while the caller reads the
 * body, a bounded redirect chain that never carries credentials to another
 * origin or downgrades HTTPS, and `readBodyCapped` so an unbounded or
 * slow-trickling body cannot exhaust memory.
 */
const ALLOWED_SCHEMES = new Set(["http", "https"])
export const MAX_REDIRECT_HOPS = 5

export class SafeUrlError extends Error {
  public override readonly name = "SafeUrlError"
  public constructor(message: string) {
    super(message)
  }
}

export type SafeHttpOptions = {
  readonly maxRedirectHops?: number
  readonly fetchImpl?: typeof fetch
  readonly timeoutMs?: number
  /** Proxy, trusted CAs and client certificates; `configure` replaces it. */
  readonly network?: NetworkConfig
}

export type SafeFetchOptions = {
  /** Follow 3xx redirects (default true). `false` returns the redirect response as-is. */
  readonly followRedirects?: boolean
  /** Verify the TLS certificate chain (default true). Per-node opt-out for self-signed dev endpoints. */
  readonly rejectUnauthorized?: boolean
  /** Override the default response/body timeout. Set to zero only for a caller-managed stream lifetime. */
  readonly timeoutMs?: number
  /**
   * The run's cookie jar. Each hop sends the cookies it holds for that URL
   * (RFC 6265 domain, path, Secure and expiry matching) and stores what the
   * response sets, so a cookie set by a 302 reaches the next hop. A cookie the
   * request names itself wins over the jar's cookie of the same name.
   */
  readonly cookieJar?: CookieJar
}

export class SafeHttp {
  private readonly maxRedirectHops: number
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private network: NetworkDispatchers

  public constructor(opts: SafeHttpOptions = {}) {
    this.maxRedirectHops = opts.maxRedirectHops ?? MAX_REDIRECT_HOPS
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.timeoutMs = opts.timeoutMs ?? 30_000
    this.network = new NetworkDispatchers(opts.network)
  }

  /**
   * Switch to a new network config for the next request. Requests already
   * sent finish on the old connection pools, which close once they drain —
   * not awaited, since an SSE listener without a deadline may hold one open
   * for as long as its run lasts.
   */
  public configure(config: NetworkConfig): void {
    const previous = this.network
    this.network = new NetworkDispatchers(config)
    previous.close().catch(() => undefined)
  }

  /** Close the connection pools a network config opened (the global agent is not ours). */
  public close(): Promise<void> {
    return this.network.close()
  }

  // -------------------- Pure validation (no I/O) --------------------

  /** Pure check — parses as a URL, http(s) scheme, non-empty host. */
  public isSafeUrl(url: string): boolean {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return false
    }
    if (!ALLOWED_SCHEMES.has(parsed.protocol.replace(":", "").toLowerCase())) return false
    return stripIpv6Brackets(parsed.hostname).length > 0
  }

  /** Throw `SafeUrlError` if `url` is not a requestable http(s) URL. */
  public validateUrl(url: string): void {
    if (!this.isSafeUrl(url)) {
      throw new SafeUrlError(`Not a requestable http(s) URL: ${url}`)
    }
  }

  /** True if a redirect from `currentUrl` to `nextUrl` is permitted. Resolves relative redirects. */
  public checkRedirectAllowed(currentUrl: string, nextUrl: string): boolean {
    if (!nextUrl) return false
    let target: string
    try {
      const parsed = new URL(nextUrl)
      if (parsed.protocol && parsed.host) {
        target = parsed.toString()
      } else {
        target = new URL(nextUrl, new URL(currentUrl)).toString()
      }
    } catch {
      try {
        target = new URL(nextUrl, new URL(currentUrl)).toString()
      } catch {
        return false
      }
    }
    return this.isSafeUrl(target)
  }

  // -------------------- HTTP wrappers (undici-based) --------------------

  /**
   * Execute an HTTP request with a deadline and a bounded redirect chain.
   * Redirects follow the fetch spec: a 303 (or a 301/302 answering a POST)
   * becomes a bodiless GET, credentials never cross to another origin, and an
   * HTTPS request is never downgraded to HTTP.
   */
  public async safeFetch(url: string, init: RequestInit = {}, opts: SafeFetchOptions = {}): Promise<Response> {
    this.validateUrl(url)
    // Compose our timeout with the caller's signal so node-level timeouts and
    // external cancellation aren't dropped. The timeout signal is never cleared,
    // so it keeps enforcing while the caller reads the body — undici aborts the
    // body stream if the signal fires, closing the "slow/endless body" gap.
    const signal = composeAbortSignal(opts.timeoutMs ?? this.timeoutMs, init.signal)
    const followRedirects = opts.followRedirects ?? true
    const maxHops = followRedirects ? this.maxRedirectHops : 0
    let requestInit: RequestInit = { ...init, redirect: "manual", signal }
    let currentUrl = url
    for (let hop = 0; hop <= maxHops; hop++) {
      const jar = opts.cookieJar
      // Per hop: a redirect to another host may need another client certificate, or bypass the proxy.
      const dispatcher = this.network.dispatcherFor(currentUrl, opts.rejectUnauthorized ?? true)
      const hopInit = jar ? withJarCookies(requestInit, jar, currentUrl) : requestInit
      const response = await this.fetchImpl(currentUrl, dispatcher ? { ...hopInit, dispatcher } : hopInit)
      if (jar) storeCookies(jar, response, currentUrl)
      const hopResult = this.resolveHop(currentUrl, response, followRedirects, hop)
      if (hopResult.done) return hopResult.response
      await response.body?.cancel()
      requestInit = redirectInit(requestInit, response.status, currentUrl, hopResult.nextUrl)
      currentUrl = hopResult.nextUrl
    }
    throw new SafeUrlError(`Too many redirects (>${this.maxRedirectHops}) — last URL: ${currentUrl}`)
  }

  /** One redirect-chain step: either the final response, or the next URL to follow. */
  private resolveHop(
    currentUrl: string,
    response: Response,
    followRedirects: boolean,
    hop: number,
  ): { done: true; response: Response } | { done: false; nextUrl: string } {
    if (response.status < 300 || response.status >= 400 || !followRedirects) return { done: true, response }
    const location = response.headers.get("location")
    if (!location) return { done: true, response }
    if (!this.checkRedirectAllowed(currentUrl, location)) {
      throw new SafeUrlError(`Redirect to an unrequestable URL after ${hop + 1} hop(s): ${location}`)
    }
    const nextUrl = new URL(location, currentUrl).toString()
    if (new URL(currentUrl).protocol === "https:" && new URL(nextUrl).protocol === "http:") {
      throw new SafeUrlError(`${HTTPS_DOWNGRADE_MESSAGE}: ${nextUrl}`)
    }
    return { done: false, nextUrl }
  }

  /** GET — no redirect following, validates the URL once. */
  public async safeGet(url: string, init: RequestInit = {}): Promise<Response> {
    return this.safeFetch(url, { ...init, method: "GET", redirect: "manual" })
  }

  /** POST — no redirect following. */
  public async safePost(url: string, init: RequestInit = {}): Promise<Response> {
    return this.safeFetch(url, { ...init, method: "POST", redirect: "manual" })
  }

  /**
   * Read a response body, capped at `maxBytes`. A malicious or compromised
   * endpoint can otherwise return an unbounded or slow-trickling body and
   * exhaust memory/CPU; this stops pulling bytes off the stream (and cancels
   * the underlying connection) the moment the cap is hit instead of buffering
   * the whole thing. A truncated read keeps the first `maxBytes` bytes.
   */
  public async readBodyCapped(response: Response, maxBytes: number): Promise<{ bytes: Buffer; truncated: boolean }> {
    const reader = response.body?.getReader()
    if (!reader) {
      const bytes = Buffer.from(await response.arrayBuffer())
      return bytes.byteLength > maxBytes ? { bytes: bytes.subarray(0, maxBytes), truncated: true } : { bytes, truncated: false }
    }

    const chunks: Buffer[] = []
    let received = 0
    let truncated = false
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) {
        truncated = true
        const overflow = received - maxBytes
        chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength - overflow))
        await reader.cancel()
        break
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
    }
    return { bytes: Buffer.concat(chunks), truncated }
  }

  /** `readBodyCapped`, decoded as UTF-8. */
  public async readTextCapped(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
    const { bytes, truncated } = await this.readBodyCapped(response, maxBytes)
    return { text: bytes.toString("utf-8"), truncated }
  }
}

export const HTTPS_DOWNGRADE_MESSAGE = "Refused redirect from HTTPS to HTTP"

/** Every message `describeNetworkError` returns starts with this. */
export const NETWORK_ERROR_PREFIX = "Network error: "

const TLS_ERROR_CODE = /CERT|SELF_SIGNED|ERR_TLS|ERR_SSL|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/

/**
 * A readable cause for a failed request, or null when `error` is not a
 * network failure. undici reports every connection failure as `TypeError:
 * fetch failed` and puts the system error (with its `code`) in `cause`, so the
 * chain is walked to the first error that carries one.
 */
export function describeNetworkError(error: unknown, url: string): string | null {
  let host: string
  try {
    host = new URL(url).host
  } catch {
    host = url
  }
  for (let current: unknown = error, depth = 0; current instanceof Error && depth < 8; current = current.cause, depth++) {
    const code = (current as { code?: unknown }).code
    if (typeof code !== "string") continue
    const detail = describeErrorCode(code, host, current.message)
    return `${NETWORK_ERROR_PREFIX}${detail} (${code})`
  }
  return null
}

function describeErrorCode(code: string, host: string, message: string): string {
  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return `could not resolve host ${host}`
    case "ECONNREFUSED":
      return `connection refused by ${host}`
    case "ECONNRESET":
    case "EPIPE":
    case "UND_ERR_SOCKET":
      return `connection to ${host} was closed unexpectedly`
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
      return `connecting to ${host} timed out`
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return `${host} is unreachable`
    default:
      return TLS_ERROR_CODE.test(code) ? `TLS handshake with ${host} failed: ${message}` : message
  }
}

function stripIpv6Brackets(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1)
  }
  return hostname
}

/**
 * `init` with the jar's cookies for `url` added to its Cookie header. The
 * jar's cookies are added per hop and never written back into the init the
 * redirect chain carries, so a cross-origin hop drops the user's own Cookie
 * header and still gets the jar's cookies for the new host.
 */
function withJarCookies(init: RequestInit, jar: CookieJar, url: string): RequestInit {
  const headers = new Headers(init.headers)
  const own = headers.get("cookie")
  const ownNames = new Set((own ?? "").split(";").map((pair) => pair.split("=")[0]!.trim()))
  const fromJar = jar
    .getCookiesSync(url)
    .filter((cookie) => !ownNames.has(cookie.key))
    .map((cookie) => cookie.cookieString())
  if (fromJar.length === 0) return init
  headers.set("cookie", [...fromJar, ...(own ? [own] : [])].join("; "))
  return { ...init, headers }
}

/** Store every Set-Cookie of `response`; one the jar refuses (another domain, a public suffix) is dropped. */
function storeCookies(jar: CookieJar, response: Response, url: string): void {
  for (const setCookie of response.headers.getSetCookie()) {
    jar.setCookieSync(setCookie, url, { ignoreError: true })
  }
}

const CREDENTIAL_HEADERS = ["authorization", "cookie", "proxy-authorization"]
const BODY_HEADERS = ["content-type", "content-length", "content-encoding", "content-language", "content-location"]

/**
 * The request to send to `nextUrl` after a `status` redirect, per the fetch
 * spec's HTTP-redirect fetch: 303 turns anything but GET/HEAD into a bodiless
 * GET, and so does 301/302 for a POST; 307/308 resend the method and body.
 * Credentials the user attached (Authorization, Cookie, Proxy-Authorization)
 * are for the origin they named and are dropped when the redirect leaves it.
 */
function redirectInit(init: RequestInit, status: number, currentUrl: string, nextUrl: string): RequestInit {
  const method = (init.method ?? "GET").toUpperCase()
  const headers = new Headers(init.headers)
  const next: RequestInit = { ...init, headers }
  if ((status === 303 && method !== "GET" && method !== "HEAD") || ((status === 301 || status === 302) && method === "POST")) {
    next.method = "GET"
    delete next.body
    for (const name of BODY_HEADERS) headers.delete(name)
  }
  if (new URL(currentUrl).origin !== new URL(nextUrl).origin) {
    for (const name of CREDENTIAL_HEADERS) headers.delete(name)
  }
  return next
}

/**
 * Compose the caller's signal with our own deadline so node-level timeouts and
 * external cancellation aren't dropped. The timeout signal is never cleared,
 * so it keeps enforcing while the caller reads the body — undici aborts the
 * body stream if the signal fires, closing the "slow/endless body" gap.
 *
 * SSE listeners with an event finish rule can deliberately wait without a
 * deadline. Their AbortController still owns cancellation; never create an
 * `AbortSignal.timeout(0)`, which aborts immediately rather than meaning none.
 */
function composeAbortSignal(timeoutMs: number, callerSignal: AbortSignal | null | undefined): AbortSignal {
  const signals: AbortSignal[] = []
  if (timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs))
  if (callerSignal) signals.push(callerSignal)
  return signals.length === 1 ? signals[0]! : AbortSignal.any(signals)
}
