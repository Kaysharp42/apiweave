import type { TutorialScope } from "../types";

/** Slug used when a pathname is empty or names no workspace. */
const FALLBACK_SLUG = "personal";

/**
 * Second segments that identify a workspace-scoped route without an org
 * prefix: `/personal/workflows`, `/personal/tutorials`, `/personal/settings/...`
 * and `/personal/projects/...`. Any other second segment is read as the
 * `/:orgSlug/:workspaceSlug/...` shape the app also matches.
 */
const WORKSPACE_SECTION_SEGMENTS = new Set([
  "workflows",
  "tutorials",
  "settings",
  "projects",
]);

/**
 * Top-level routes that never belong to a workspace. Read as an `org/slug`
 * pair they would resolve to nonsense, so they take the fallback instead; for
 * example `/cloud/sync` is not org `cloud` in workspace `sync`.
 */
const TOP_LEVEL_SEGMENTS = new Set(["app", "cloud", "setup"]);

/**
 * Resolve the organization and workspace slugs from a location pathname.
 *
 * The app matches both `/:workspaceSlug/<section>` and
 * `/:orgSlug/:workspaceSlug/<section>`, and a pathname alone does not label
 * which shape it is. The second segment decides: a known workspace section
 * means there is no org prefix, anything else is the org/workspace pair. A
 * pathname that fits neither shape falls back to the personal workspace, so a
 * link is always produced and the router decides whether it resolves.
 */
export function resolveTutorialScope(pathname: string): TutorialScope {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const first = segments[0];
  if (first === undefined || TOP_LEVEL_SEGMENTS.has(first)) {
    return { orgSlug: FALLBACK_SLUG, workspaceSlug: FALLBACK_SLUG };
  }

  const second = segments[1];
  if (second === undefined || WORKSPACE_SECTION_SEGMENTS.has(second)) {
    return { orgSlug: FALLBACK_SLUG, workspaceSlug: first };
  }

  return { orgSlug: first, workspaceSlug: second };
}
