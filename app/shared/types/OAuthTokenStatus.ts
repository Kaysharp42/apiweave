/** What the Auth tab shows about a stored OAuth 2.0 token. Never a token value. */
export interface OAuthTokenStatus {
  readonly stored: boolean
  /** From the OpenID `id_token`, when the server sent one. */
  readonly authorizedAs: string | null
  /** ISO time the access token expires; null when unknown or not stored. */
  readonly expiresAt: string | null
  readonly hasRefreshToken: boolean
}
