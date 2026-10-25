/** Where an account can create a repository: itself, or one of its GitHub organizations or GitLab groups. */
export interface GitRepositoryOwner {
  /** The login, organization or group path (`acme/qa` for a GitLab subgroup). */
  readonly path: string
  readonly kind: "user" | "organization" | "group"
}
