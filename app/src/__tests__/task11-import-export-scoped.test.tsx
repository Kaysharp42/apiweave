import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Task 11: import/export never target an unresolved workspace", () => {
  const componentDir = resolve(__dirname, "..", "components");
  const hooksDir = resolve(__dirname, "..", "hooks");

  it("WorkflowExportImport does not fall back to an empty workspace id", () => {
    const source = readFileSync(resolve(componentDir, "WorkflowExportImport.tsx"), "utf-8");
    expect(source).not.toContain("workspaceId || \"\"");
    expect(source).toContain("resolveWorkspaceId");
  });

  it("useSwaggerRefresh does not fall back to an empty workspace id", () => {
    const source = readFileSync(resolve(hooksDir, "useSwaggerRefresh.ts"), "utf-8");
    expect(source).not.toContain("workspaceId || \"\"");
    expect(source).toContain("workspace-not-ready");
  });
});
