import dns from "node:dns/promises"
import type { LookupAddress } from "node:dns"
import { BlockList as NodeBlockList, isIP } from "node:net"
import { fetch, Headers, type RequestInit, type Response } from "undici"

// @types/node dropped the exported `AddressType` alias; net.BlockList's
// IPVersion parameter is the lowercase pair.
type AddressType = "ipv4" | "ipv6"

/**
 * Safe HTTP utility for SSRF prevention.
 *
 * Ported from `backend/app/services/safe_http.py`. Outbound HTTP from the
 * runner (HTTP request nodes) goes through here. The desktop single-user
 * default sets `allowLoopback = true` so the user's `localhost` dev services
 * are reachable; RFC1918, link-local (cloud metadata at 169.254.169.254),
 * IPv6 unique-local, multicast, and unspecified ranges stay blocked regardless.
 *
 * Block list via `node:net.BlockList` — stdlib native, no CIDR math to write.
 * Redirects: undici `redirect: 'manual'`, each hop re-validated (no TOCTOU).
 * DNS rebinding: `assertHostResolvesSafe` resolves the hostname and rejects
 * if ANY returned address is in a blocked network. The caller then connects
 * to the pinned IP (via `Host` header preservation), closing the
 * validate-vs-connect gap.
 */
const BLOCKED_IPV4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["127.0.0.0", 8], // loopback (carved-out when allowLoopback)
  ["169.254.0.0", 16], // link-local / AWS metadata
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 4], // multicast
]
const BLOCKED_IPV6: ReadonlyArray<readonly [string, number]> = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback (carved-out when allowLoopback)
  ["fc00::", 7], // unique-local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
]
const LOOPBACK_IPV4: ReadonlyArray<readonly [string, number]> = [["127.0.0.0", 8]]
const LOOPBACK_IPV6: ReadonlyArray<readonly [string, number]> = [["::1", 128]]
const DEV_ALLOWED_HOSTS = new Set(["host.docker.internal"])

const ALLOWED_SCHEMES = new Set(["http", "https"])
export const MAX_REDIRECT_HOPS = 5

export class SafeUrlError extends Error {
  public override readonly name = "SafeUrlError"
  public constructor(message: string) {
    super(message)
  }
}

export type SafeHttpOptions = {
  readonly allowLoopback?: boolean
  readonly approvedDomains?: readonly string[]
  readonly maxRedirectHops?: number
  readonly fetchImpl?: typeof fetch
  readonly dnsLookup?: (host: string) => Promise<readonly LookupAddress[]>
  readonly timeoutMs?: number
}

export class SafeHttp {
  private readonly blocklist: NodeBlockList
  private readonly loopbackList: NodeBlockList
  private readonly allowLoopback: boolean
  private readonly approvedDomains: readonly string[]
  private readonly approvedDomainsEnabled: boolean
  private readonly maxRedirectHops: number
  private readonly fetchImpl: typeof fetch
  private readonly dnsLookup: SafeHttpOptions["dnsLookup"]
  private readonly timeoutMs: number

  public constructor(opts: SafeHttpOptions = {}) {
    this.allowLoopback = opts.allowLoopback ?? true
    this.approvedDomains = opts.approvedDomains ?? []
    this.approvedDomainsEnabled = this.approvedDomains.length > 0
    this.maxRedirectHops = opts.maxRedirectHops ?? MAX_REDIRECT_HOPS
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.dnsLookup = opts.dnsLookup ?? ((host: string) => dns.lookup(host, { all: true, verbatim: true }))
    this.timeoutMs = opts.timeoutMs ?? 30_000

    this.blocklist = buildBlocklist(BLOCKED_IPV4, BLOCKED_IPV6)
    this.loopbackList = buildBlocklist(LOOPBACK_IPV4, LOOPBACK_IPV6)
  }

  // -------------------- Pure validation (no I/O) --------------------

  /** Pure check — scheme + hostname + (optional) domain allowlist + IP-literal block. */
  public isSafeUrl(url: string): boolean {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return false
    }
    if (!ALLOWED_SCHEMES.has(parsed.protocol.replace(":", "").toLowerCase())) return false
    const hostname = stripIpv6Brackets(parsed.hostname)
    if (!hostname) return false
    if (this.approvedDomainsEnabled && !this.hostInApprovedDomains(hostname)) return false
    if (this.isDevAllowedHost(hostname)) return true
    const family = isIP(hostname)
    if (family === 4 || family === 6) {
      if (this.isBlockedIp(hostname, family)) return false
    }
    return true
  }

  /** Throw `SafeUrlError` if `url` is unsafe. */
  public validateUrl(url: string): void {
    if (!this.isSafeUrl(url)) {
      throw new SafeUrlError(`URL blocked by safety policy: ${url}`)
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

  // -------------------- Resolve-then-check (DNS rebinding guard) --------------------

  /** Resolve `host` and throw `SafeUrlError` if any resolved address is blocked. */
  public async assertHostResolvesSafe(host: string): Promise<void> {
    await this.resolveAndPinIp(host)
  }

  /**
   * Resolve `host`; reject if any resolved address is blocked; return one
   * safe address to pin the connection to (or `null` for dev-allowed hosts
   * and unresolvable names — let the caller's client surface the error).
   */
  public async resolveAndPinIp(host: string): Promise<string | null> {
    if (!host) throw new SafeUrlError("Missing host")
    if (this.isDevAllowedHost(host)) return null
    let infos: LookupAddress[]
    try {
      infos = [...(await this.dnsLookup!.call(null, host))]
    } catch {
      return null
    }
    for (const info of infos) {
      const family = info.family === 6 ? 6 : 4
      if (this.isBlockedIp(info.address, family)) {
        throw new SafeUrlError(`Host ${host} resolves to blocked address ${info.address}`)
      }
    }
    return infos[0]?.address ?? null
  }

  // -------------------- HTTP wrappers (undici-based, fail-closed) --------------------

  /** Execute an HTTP request with SSRF protection + per-hop redirect validation. */
  public async safeFetch(url: string, init: RequestInit = {}): Promise<Response> {
    this.validateUrl(url)
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), this.timeoutMs)
    let currentUrl = url
    let lastInit: RequestInit = { ...init, redirect: "manual", signal: abort.signal }
    try {
      for (let hop = 0; hop <= this.maxRedirectHops; hop++) {
        const pinnedIp = await this.resolveAndPinIp(hostOf(currentUrl))
        const reqUrl = pinnedIp ? rewriteWithPinnedIp(currentUrl, pinnedIp) : currentUrl
        const hostHeader = hostOf(currentUrl)
        const headers = new Headers(init.headers)
        if (pinnedIp) headers.set("Host", hostHeader)
        lastInit = { ...lastInit, headers }
        const response = await this.fetchImpl(reqUrl, lastInit)
        if (response.status < 300 || response.status >= 400) return response
        const location = response.headers.get("location")
        if (!location) return response
        if (!this.checkRedirectAllowed(currentUrl, location)) {
          throw new SafeUrlError(`Redirect to blocked URL denied after ${hop + 1} hop(s): ${location}`)
        }
        currentUrl = new URL(location, currentUrl).toString()
      }
      throw new SafeUrlError(`Too many redirects (>${this.maxRedirectHops}) — last URL: ${currentUrl}`)
    } finally {
      clearTimeout(timer)
    }
  }

  /** Safe GET — no redirect following, validates the URL once. */
  public async safeGet(url: string, init: RequestInit = {}): Promise<Response> {
    return this.safeFetch(url, { ...init, method: "GET", redirect: "manual" })
  }

  /** Safe POST — no redirect following. */
  public async safePost(url: string, init: RequestInit = {}): Promise<Response> {
    return this.safeFetch(url, { ...init, method: "POST", redirect: "manual" })
  }

  // -------------------- Internals --------------------

  private isBlockedIp(address: string, family: 4 | 6): boolean {
    const type: AddressType = family === 6 ? "ipv6" : "ipv4"
    if (this.allowLoopback && this.loopbackList.check(address, type)) return false
    return this.blocklist.check(address, type)
  }

  private isDevAllowedHost(host: string): boolean {
    return this.allowLoopback && DEV_ALLOWED_HOSTS.has(host.toLowerCase())
  }

  private hostInApprovedDomains(host: string): boolean {
    if (this.approvedDomains.length === 0) return false
    const lower = host.toLowerCase()
    return this.approvedDomains.some((d) => d.toLowerCase() === lower)
  }
}

function buildBlocklist(v4: readonly (readonly [string, number])[], v6: readonly (readonly [string, number])[]): NodeBlockList {
  const list = new NodeBlockList()
  for (const [addr, prefix] of v4) list.addSubnet(addr, prefix, "ipv4")
  for (const [addr, prefix] of v6) list.addSubnet(addr, prefix, "ipv6")
  return list
}

function hostOf(url: string): string {
  try {
    return stripIpv6Brackets(new URL(url).hostname)
  } catch {
    return ""
  }
}

function stripIpv6Brackets(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1)
  }
  return hostname
}

/**
 * Rewrite the URL's host with the resolved IP, preserving scheme + port + path + query.
 * Used only when we resolved and verified the pin — keeps DNS rebinding out.
 */
function rewriteWithPinnedIp(url: string, ip: string): string {
  const parsed = new URL(url)
  const port = parsed.port ? `:${parsed.port}` : ""
  parsed.hostname = ip
  parsed.host = `${ip}${port}`
  return parsed.toString()
}
