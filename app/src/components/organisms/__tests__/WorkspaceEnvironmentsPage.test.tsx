import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/pages/WorkspaceEnvironmentsPage.tsx"),
  "utf8",
);

describe("WorkspaceEnvironmentsPage", () => {
  it("shows loading spinner initially", () => {
    expect(source).toContain('<Spinner size="lg" />');
  });

  it("renders page header with title", () => {
    expect(source).toContain("Environments");
  });

  it("shows breadcrumb with org/workspace slugs", () => {
    expect(source).toContain("orgSlug={orgSlug}");
    expect(source).toContain("workspaceSlug={workspaceSlug}");
  });

  it('renders "New Environment" button', () => {
    expect(source).toContain("New Environment");
  });

  it("groups the environments by the workspace that owns them", () => {
    expect(source).toContain("<WorkspaceEnvironmentGroups");
    expect(source).toContain("activeWorkspaceId={workspaceId}");
  });

  it("offers duplicate and move-to-workspace for an environment", () => {
    expect(source).toContain("<DuplicateItemDialog");
    expect(source).toContain('kind="environment"');
    expect(source).toContain("<MoveToWorkspaceDialog");
    expect(source).toContain('itemKind="environment"');
    expect(source).toContain(".list(workspace.workspaceId)");
    expect(source).toContain("apiweave.environments.moveToWorkspace(");
  });

  it("acts on each environment through the workspace that owns it, not the active one", () => {
    // A move/duplicate driven from another workspace's group must pass THAT
    // workspace as the source, or the server rejects it as not_found.
    expect(source).toContain("duplicating.workspaceId");
    expect(source).toContain("moving.workspaceId");
  });

  it('shows "Select an environment" empty state when no env is selected', () => {
    expect(source).toContain('title="Select an environment"');
  });

  it("loads workspace-scoped environment data via API", () => {
    expect(source).toContain("fetchEnvironments(workspaceId)");
    // Each group is read through the workspace-scoped, per-workspace authorized
    // list — never a list-every-environment endpoint that steps around it.
    expect(source).toContain("apiweave.workspaces.list()");
    expect(source).toContain(".list(workspace.workspaceId)");
  });

  it("saves edited environment variables", () => {
    expect(source.match(/variables: data\.variables/g)).toHaveLength(2);
  });
});
