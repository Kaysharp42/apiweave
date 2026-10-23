import type { GitProvider } from "./GitProvider"

/** What a sign-in in progress asks of the user: enter `code` on the page at `url`. */
export interface GitSignInPrompt {
  readonly provider: GitProvider
  readonly host: string
  /** The one-time code `gh` or `glab` printed. */
  readonly code: string
  /** The host's own device-login page, which main opens in the browser. */
  readonly url: string
}
