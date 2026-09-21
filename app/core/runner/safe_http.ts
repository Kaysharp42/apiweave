import { Agent, fetch, type Dispatcher, type RequestInit, type Response } from "undici"

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
 * body, a bounded redirect chain, and `readTextCapped` so an unbounded or
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
}

export type SafeFetchOptions = {
  /** Follow 3xx redirects (default true). `false` returns the redirect response as-is. */
  readonly followRedirects?: boolean
  /** Verify the TLS certificate chain (default true). Per-node opt-out for self-signed dev endpoints. */
  readonly rejectUnauthorized?: boolean
  /** Override the default response/body timeout. Set to zero only for a caller-managed stream lifetime. */
  readonly timeoutMs?: number
}

export class SafeHttp {
  private readonly maxRedirectHops: number
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  public constructor(opts: SafeHttpOptions = {}) {
    this.maxRedirectHops = opts.maxRedirectHops ?? MAX_REDIRECT_HOPS
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.timeoutMs = opts.timeoutMs ?? 30_000
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

  /** Execute an HTTP request with a deadline and a bounded redirect chain. */
  public async safeFetch(url: string, init: RequestInit = {}, opts: SafeFetchOptions = {}): Promise<Response> {
    this.validateUrl(url)
    // Compose our timeout with the caller's signal so node-level timeouts and
    // external cancellation aren't dropped. The timeout signal is never cleared,
    // so it keeps enforcing while the caller reads the body — undici aborts the
    // body stream if the signal fires, closing the "slow/endless body" gap.
    const signal = composeAbortSignal(opts.timeoutMs ?? this.timeoutMs, init.signal)
    const followRedirects = opts.followRedirects ?? true
    const maxHops = followRedirects ? this.maxRedirectHops : 0
    const requestInit: RequestInit = withDispatcher({ ...init, redirect: "manual", signal }, opts.rejectUnauthorized)
    let currentUrl = url
    for (let hop = 0; hop <= maxHops; hop++) {
      const response = await this.fetchImpl(currentUrl, requestInit)
      const hopResult = this.resolveHop(currentUrl, response, followRedirects, hop)
      if (hopResult.done) return hopResult.response
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
    return { done: false, nextUrl: new URL(location, currentUrl).toString() }
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
   * Read a response body as text, capped at `maxBytes`. A malicious or
   * compromised endpoint can otherwise return an unbounded or slow-trickling
   * body and exhaust memory/CPU; this stops pulling bytes off the stream (and
   * cancels the underlying connection) the moment the cap is hit instead of
   * buffering the whole thing via `response.text()`.
   */
  public async readTextCapped(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
    const contentLength = Number(response.headers.get("content-length") ?? "")
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      await response.body?.cancel()
      return { text: "", truncated: true }
    }

    const reader = response.body?.getReader()
    if (!reader) {
      const text = await response.text()
      return text.length > maxBytes ? { text: text.slice(0, maxBytes), truncated: true } : { text, truncated: false }
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
    return { text: Buffer.concat(chunks).toString("utf-8"), truncated }
  }
}

function stripIpv6Brackets(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1)
  }
  return hostname
}

/** Dispatcher for the per-node "accept a self-signed certificate" opt-out. */
function buildInsecureTlsDispatcher(): Dispatcher {
  return new Agent({ connect: { rejectUnauthorized: false } })
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

/**
 * Attach the per-node "accept a self-signed certificate" dispatcher when
 * requested. Everything else rides undici's default global agent, which
 * pools connections across requests.
 */
function withDispatcher(init: RequestInit, rejectUnauthorized: boolean | undefined): RequestInit {
  return rejectUnauthorized === false ? { ...init, dispatcher: buildInsecureTlsDispatcher() } : init
}
