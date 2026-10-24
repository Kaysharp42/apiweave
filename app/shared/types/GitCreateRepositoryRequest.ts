/** A repository to create: under which owner, its name, and whether only invited people can see it. */
export interface GitCreateRepositoryRequest {
  readonly owner: string
  readonly name: string
  readonly private: boolean
}
