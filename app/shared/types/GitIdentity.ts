/** A commit author: what git reads from `user.name` and `user.email`. */
export interface GitIdentity {
  readonly name: string
  readonly email: string
}
