import type { OAuth2AuthConfig } from "./OAuth2AuthConfig"

/**
 * Which stored OAuth 2.0 token a Get token / status / clear call is about: an
 * HTTP node's `auth.oauth2`, read in its workflow's workspace and environment
 * (the scope chain its `tokenSecret` resolves down, as during a run).
 */
export interface OAuthTokenRequest {
  readonly workspaceId: string
  readonly environmentId: string | null
  readonly oauth2: OAuth2AuthConfig
}
