import type { OAuthTokenRequest } from "./OAuthTokenRequest"
import type { OAuthTokenStatus } from "./OAuthTokenStatus"

/**
 * The `window.__APIWEAVE_OAUTH__` contract. Off the IPC router for the same
 * reason as the agents bridge: the router is the MCP bridge's handler list, and
 * opening the system browser or writing a token into the secret store is not
 * something a local agent may reach.
 */
export interface OAuthBridge {
  /** Sign in in the system browser (authorization code + PKCE) and store the token. */
  readonly authorize: (request: OAuthTokenRequest) => Promise<OAuthTokenStatus>
  readonly status: (request: OAuthTokenRequest) => Promise<OAuthTokenStatus>
  readonly clear: (request: OAuthTokenRequest) => Promise<OAuthTokenStatus>
}
