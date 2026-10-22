import type { GitProvider } from "./GitProvider"

/** A provider's command-line tool on this machine: whether it is on PATH, which version, and anything that kept it from answering. */
export interface GitHostCli {
  readonly provider: GitProvider
  readonly command: "gh" | "glab"
  /** Not on PATH: the provider has no accounts here until it is installed. */
  readonly missing: boolean
  /** As the tool prints it, e.g. `2.97.0`; null when missing or unreadable. */
  readonly version: string | null
  /** What went wrong asking the tool, when something did; null otherwise. */
  readonly problem: string | null
}
