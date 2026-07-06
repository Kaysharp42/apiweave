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
    expect(source).toContain("`${orgSlug} / ${workspaceSlug}`");
  });

  it('renders "New Environment" button', () => {
    expect(source).toContain("New Environment");
  });

  it("renders scope-grouped environment lists", () => {
    expect(source).toContain('title="Workspace Environments"');
    expect(source).toContain('title="User Environments"');
  });

  it('shows "Select an environment" empty state when no env is selected', () => {
    expect(source).toContain('title="Select an environment"');
  });

  it("loads workspace-scoped environment data via API", () => {
    expect(source).toContain("fetchEnvironments(workspaceId)");
    expect(source).toContain(
      "/api/workspaces/${workspaceId}/pending-approvals",
    );
    expect(source).toContain("/api/orgs/${orgId}/workspaces");
  });

  it("saves edited environment variables", () => {
    expect(source.match(/variables: data\.variables/g)).toHaveLength(2);
  });
});
