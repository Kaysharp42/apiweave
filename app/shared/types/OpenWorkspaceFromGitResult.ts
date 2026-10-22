/**
 * What opening a workspace from a git repository came to. `duplicate` is not a
 * failure: the repository's workspace is already in this app, and the caller
 * links to it by `slug` instead of opening a second copy. `opened` carries the
 * importer's warnings (a withheld credential kept as `<SECRET>`, a repaired
 * default environment) so the caller can show them before switching.
 */
export type OpenWorkspaceFromGitResult =
  | {
      readonly kind: "opened"
      readonly workspaceId: string
      readonly slug: string
      readonly name: string
      readonly warnings: readonly string[]
    }
  | { readonly kind: "duplicate"; readonly workspaceId: string; readonly slug: string; readonly name: string }
