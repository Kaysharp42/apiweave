/**
 * App-scoped http-safety settings. `allowPrivateNetworks` opts outbound
 * HTTP (runner + URL imports) into RFC1918/unique-local targets, which are
 * blocked by the SSRF guard by default. Link-local and multicast ranges
 * stay blocked regardless.
 */
export interface HttpSafetySettings {
  readonly allowPrivateNetworks: boolean;
}
