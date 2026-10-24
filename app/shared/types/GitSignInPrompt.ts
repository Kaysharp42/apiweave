import type { GitProvider } from "./GitProvider"

/** What a sign-in in progress asks of the user: open the page at `url`, and enter `code` there when there is one. */
export interface GitSignInPrompt {
  readonly provider: GitProvider
  readonly host: string
  /** The one-time code `gh` or `glab` printed; null when the host has no device flow and the browser alone finishes the sign-in. */
  readonly code: string | null
  /** The host's own device-login page, which main opens in the browser. */
  readonly url: string
}
