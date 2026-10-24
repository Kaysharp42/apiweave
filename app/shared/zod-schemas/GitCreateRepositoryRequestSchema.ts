import { z } from "zod"

/** A word: letters and digits, with single `.`, `_` or `-` between them. */
const SEGMENT = "[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*"

/**
 * What GitHub and GitLab both accept as a repository name, as one rule:
 * GitLab's path must start and end with a letter or digit and never hold two
 * special characters in a row; GitHub allows letters, digits, `.`, `_` and
 * `-`. A name never starts with `-`, so it is never read as an option, and
 * holds no `/`, `%` or `:`, so it is one segment of an API path as it is.
 * `.git` and `.atom` endings are GitLab's reserved suffixes.
 */
export const GitRepositoryNameSchema = z
  .string()
  .max(100, "a repository name is at most 100 characters")
  .regex(new RegExp(`^${SEGMENT}$`), "use letters and digits, with single . _ or - between them")
  .refine((name) => !/\.(git|atom)$/i.test(name), "a repository name cannot end in .git or .atom")

/**
 * A user, organization or group to create a repository under: the same words,
 * with `/` between a GitLab group and its subgroups.
 */
export const GitRepositoryOwnerSchema = z
  .string()
  .max(255)
  .regex(new RegExp(`^${SEGMENT}(?:/${SEGMENT})*$`), "not a user, organization or group name")

/** A {@link GitRepositoryListRequest} from the renderer: two flags, nothing else. */
export const GitRepositoryListRequestSchema = z.object({ tagged: z.boolean(), emptyOnly: z.boolean() }).strict()

/** A {@link GitCreateRepositoryRequest} from the renderer, checked before any tool sees it. */
export const GitCreateRepositoryRequestSchema = z
  .object({
    owner: GitRepositoryOwnerSchema,
    name: GitRepositoryNameSchema,
    private: z.boolean(),
  })
  .strict()
