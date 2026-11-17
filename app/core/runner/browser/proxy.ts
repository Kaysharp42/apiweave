import type { NetworkConfig } from "../network"
import type { BrowserProxy } from "./session"

/**
 * The run's proxy for its browser, so a page goes the way its requests do:
 * Settings > Network in the app, `--proxy` or `HTTPS_PROXY` in the CLI.
 * Undefined without a proxy, which leaves the browser on its own (on
 * Windows and macOS the system's proxy, on a headless Linux machine the
 * proxy environment variables).
 *
 * The credentials in the proxy's URL move to Playwright's own fields, and
 * `NO_PROXY` becomes Chrome's bypass list. The two read a plain name
 * differently — `example.com` covers its subdomains in `NO_PROXY` and only
 * itself in Chrome — so each name is given in both forms, and the browser
 * bypasses exactly the hosts requests do.
 */
export function browserProxy(network: Pick<NetworkConfig, "proxy" | "noProxy">): BrowserProxy | undefined {
  if (network.proxy === undefined || network.proxy === "") return undefined
  const url = new URL(network.proxy)
  const username = decodeURIComponent(url.username)
  const password = decodeURIComponent(url.password)
  const bypass = bypassList(network.noProxy ?? "")
  return {
    server: `${url.protocol}//${url.host}`,
    ...(bypass === "" ? {} : { bypass }),
    ...(username === "" ? {} : { username }),
    ...(password === "" ? {} : { password }),
  }
}

/** `NO_PROXY` (`localhost,.internal,*.corp,10.0.0.1`) as Chrome's bypass rules. */
function bypassList(noProxy: string): string {
  const rules = noProxy
    .split(/[\s,]+/)
    .filter((entry) => entry !== "")
    .flatMap((entry) => {
      if (entry === "*") return ["*"]
      const name = entry.replace(/^\*?\./, "")
      return isAddress(name) ? [name] : [name, `.${name}`]
    })
  return [...new Set(rules)].join(",")
}

/** An IPv4 or IPv6 address or range, with or without a port: it has no subdomains. */
function isAddress(entry: string): boolean {
  if (/^[\d.]+(:\d+)?(\/\d+)?$/.test(entry) || entry.startsWith("[")) return true
  // A colon that is not a host's port belongs to an IPv6 address.
  return entry.includes(":") && !/^[^:]+:\d+$/.test(entry)
}
