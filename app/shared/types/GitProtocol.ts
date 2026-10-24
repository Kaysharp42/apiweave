/** How an account's CLI is set up to reach repositories: over HTTPS with a token, or over SSH with the user's own key. */
export type GitProtocol = "https" | "ssh"
