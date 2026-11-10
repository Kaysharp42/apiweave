/** How opening one tagged repository from the sign-in dialog ended. */
export type TaggedWorkspaceOutcome =
  | { readonly kind: "opened"; readonly name: string; readonly warnings: readonly string[] }
  | { readonly kind: "duplicate"; readonly name: string }
  | { readonly kind: "failed"; readonly message: string };
