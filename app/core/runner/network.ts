import fs from "node:fs"
import tls from "node:tls"
import { Agent, EnvHttpProxyAgent, type Dispatcher } from "undici"

/**
 * How the runner reaches the network: a proxy, extra trusted CAs, and client
 * certificates (mTLS) per host. Plain Node, shared by the app (Settings >
 * Network) and the CLI (`--proxy`, `--ca-cert`, `--use-system-ca`,
 * `--client-cert`). Everything here is already loaded: file contents, not
 * paths, and credentials resolved.
 */
export interface NetworkConfig {
  /** Proxy for http and https requests, credentials in the URL if any (`http://user:pass@proxy:8080`). */
  readonly proxy?: string
  /** Hosts that bypass the proxy, in NO_PROXY syntax (`localhost,.internal,10.0.0.1`). */
  readonly noProxy?: string
  /** Extra trusted CA certificates (PEM), on top of Node's bundled roots. */
  readonly ca?: readonly string[]
  /** Also trust the operating system's certificate store. */
  readonly useSystemCa?: boolean
  /** The first certificate whose `host` matches a request's URL is presented to it. */
  readonly clientCertificates?: readonly ClientCertificate[]
}

export interface ClientCertificate {
  /** `api.example.com`, `*.example.com`, optionally with a port (`api.example.com:8443`). */
  readonly host: string
  readonly cert?: Buffer
  readonly key?: Buffer
  readonly pfx?: Buffer
  readonly passphrase?: string
}

/** A client certificate as files on disk, before {@link loadClientCertificate}. */
export interface ClientCertificateFiles {
  readonly host: string
  readonly certFile?: string
  readonly keyFile?: string
  readonly pfxFile?: string
  readonly passphrase?: string
}

/**
 * The dispatchers (connection pools) for one {@link NetworkConfig}: one per
 * client certificate and TLS-verification choice, created on first use and
 * reused, so no request leaks a pool. `close` drains them when the config is
 * replaced.
 */
export class NetworkDispatchers {
  private readonly agents = new Map<string, Dispatcher>()
  private readonly ca: string[] | undefined

  public constructor(private readonly config: NetworkConfig = {}) {
    // `ca` replaces Node's roots rather than adding to them, so the defaults go in first.
    this.ca = config.useSystemCa || (config.ca?.length ?? 0) > 0
      ? [...tls.getCACertificates("default"), ...(config.useSystemCa ? tls.getCACertificates("system") : []), ...(config.ca ?? [])]
      : undefined
  }

  /** The dispatcher for a request to `url`, or undefined for undici's global agent. */
  public dispatcherFor(url: string, rejectUnauthorized: boolean): Dispatcher | undefined {
    const certificates = this.config.clientCertificates ?? []
    const index = certificates.findIndex((certificate) => hostMatches(certificate.host, url))
    if (index < 0 && rejectUnauthorized && !this.config.proxy && !this.ca) return undefined
    const key = `${index}:${rejectUnauthorized}`
    let agent = this.agents.get(key)
    if (!agent) {
      agent = this.createAgent(certificates[index], rejectUnauthorized)
      this.agents.set(key, agent)
    }
    return agent
  }

  public async close(): Promise<void> {
    await Promise.all([...this.agents.values()].map((agent) => agent.close()))
    this.agents.clear()
  }

  private createAgent(certificate: ClientCertificate | undefined, rejectUnauthorized: boolean): Dispatcher {
    const tlsOptions = {
      rejectUnauthorized,
      ...(this.ca ? { ca: this.ca } : {}),
      ...(certificate?.cert ? { cert: certificate.cert } : {}),
      ...(certificate?.key ? { key: certificate.key } : {}),
      ...(certificate?.pfx ? { pfx: certificate.pfx } : {}),
      ...(certificate?.passphrase !== undefined ? { passphrase: certificate.passphrase } : {}),
    }
    if (!this.config.proxy) return new Agent({ connect: tlsOptions })
    // Explicit values for every proxy setting: undefined would make undici read
    // HTTP_PROXY/NO_PROXY from the app's own environment. The proxy itself is
    // always verified; `rejectUnauthorized: false` is about the target only.
    return new EnvHttpProxyAgent({
      httpProxy: this.config.proxy,
      httpsProxy: this.config.proxy,
      noProxy: this.config.noProxy ?? "",
      connect: tlsOptions,
      requestTls: tlsOptions,
      proxyTls: this.ca ? { ca: this.ca } : {},
    })
  }
}

/** True if `pattern` (`host`, `*.host`, either with `:port`) names `url`'s host. */
export function hostMatches(pattern: string, url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  // An IPv6 host is written in brackets, as URL.hostname has it: `[::1]:8443`.
  const [, hostPattern = "", portPattern] = /^(.+?)(?::(\d+))?$/.exec(pattern.trim().toLowerCase()) ?? []
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80")
  if (portPattern !== undefined && portPattern !== port) return false
  const host = parsed.hostname.toLowerCase()
  return hostPattern.startsWith("*.") ? host.endsWith(hostPattern.slice(1)) : host === hostPattern
}

/**
 * Read a client certificate's files and check they make a usable TLS
 * identity (the key matches, the passphrase opens it), so a bad entry fails
 * when it is configured rather than on the first request.
 */
export function loadClientCertificate(files: ClientCertificateFiles): ClientCertificate {
  const label = `Client certificate for ${files.host}`
  if (!files.host.trim()) throw new Error("A client certificate needs a host")
  if (!files.pfxFile && !(files.certFile && files.keyFile)) {
    throw new Error(`${label}: choose a certificate and key (PEM) or a PFX/PKCS#12 file`)
  }
  const certificate: ClientCertificate = {
    host: files.host.trim(),
    ...(files.pfxFile ? { pfx: readFile(files.pfxFile, label) } : {
      cert: readFile(files.certFile!, label),
      key: readFile(files.keyFile!, label),
    }),
    ...(files.passphrase ? { passphrase: files.passphrase } : {}),
  }
  try {
    tls.createSecureContext(certificate)
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return certificate
}

/** Read CA certificate files (PEM, one or more certificates each), checking each parses. */
export function loadCaCertificates(files: readonly string[]): string[] {
  return files.map((file) => {
    const pem = readFile(file, "CA certificate").toString("utf8")
    try {
      tls.createSecureContext({ ca: pem })
    } catch (error) {
      throw new Error(`CA certificate ${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!pem.includes("-----BEGIN CERTIFICATE-----")) throw new Error(`CA certificate ${file}: not a PEM certificate`)
    return pem
  })
}

function readFile(file: string, label: string): Buffer {
  try {
    return fs.readFileSync(file)
  } catch (error) {
    const code = (error as { code?: unknown }).code
    throw new Error(`${label}: cannot read ${file}${typeof code === "string" ? ` (${code})` : ""}`)
  }
}
