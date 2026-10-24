import { z } from "zod"

/**
 * A host name, with a port for a self-hosted instance that needs one. It
 * reaches `gh`/`glab` as an argument and git's credential helper as the host
 * to answer for, so nothing but a plain name gets through.
 */
const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?$/

/** GitHub and GitLab user names alike; never starting with `-`, so never read as an option. */
const LOGIN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/

/** A git host to sign in to, as `gh --hostname` and `glab --hostname` take it. */
export const GitHostSchema = z.string().max(260).regex(HOST, "not a host name")

/** A {@link GitAccountRef} from outside main — the renderer, a database row — checked before any CLI sees it. */
export const GitAccountRefSchema = z
  .object({
    provider: z.enum(["github", "gitlab"]),
    host: GitHostSchema,
    login: z.string().max(255).regex(LOGIN, "not a user name"),
  })
  .strict()
