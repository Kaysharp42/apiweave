/**
 * Where a workspace's sync got to. Finished: the repository is created and
 * connected, and `note` is something to know about it. Not finished: it
 * stopped, and the hook holds why — git needs an author, or Version history
 * has to finish it.
 */
export type WorkspaceSyncResult =
  | { readonly finished: true; readonly note: string | null }
  | { readonly finished: false };
