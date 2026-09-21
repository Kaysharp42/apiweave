/**
 * The organization and workspace slugs a workspace-scoped route belongs to.
 * Derived from the current pathname so a tutorial trail is built from where the
 * user actually is, rather than from an assumed default.
 */
export interface TutorialScope {
  readonly orgSlug: string;
  readonly workspaceSlug: string;
}
