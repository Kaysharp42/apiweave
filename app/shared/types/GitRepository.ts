/** A repository on GitHub or GitLab, as an account sees it: what to call it and the two URLs it is reached at. */
export interface GitRepository {
  /** The user, organization or group it belongs to; a GitLab subgroup's whole path (`acme/qa`). */
  readonly owner: string
  readonly name: string
  /** `owner/name`. */
  readonly fullName: string
  readonly httpsUrl: string
  readonly sshUrl: string
  readonly private: boolean
  /** No commit on any branch: a workspace can be pushed to it. */
  readonly empty: boolean
  /** The account may push to it. */
  readonly canPush: boolean
}
