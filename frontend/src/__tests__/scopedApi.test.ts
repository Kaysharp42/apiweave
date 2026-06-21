import { describe, it, expect } from "vitest";
import API_BASE_URL from "../utils/api";
import {
  workflowUrl,
  workflowsUrl,
  environmentsUrl,
  projectsUrl,
  projectExportUrl,
  projectImportUrl,
  secretsUrl,
  personalWorkflowsUrl,
} from "../utils/scopedApi";

describe("scopedApi", () => {
  describe("workflowsUrl", () => {
    it("builds a workspace-scoped workflow URL with default pagination", () => {
      const url = workflowsUrl("ws-personal");
      expect(url).toBe(
        `${API_BASE_URL}/api/workspaces/ws-personal/workflows?skip=0&limit=20`,
      );
    });

    it("accepts custom skip and limit", () => {
      const url = workflowsUrl("ws-org-42", { skip: 10, limit: 5 });
      expect(url).toBe(
        `${API_BASE_URL}/api/workspaces/ws-org-42/workflows?skip=10&limit=5`,
      );
    });

    it("encodes special characters in workspaceId", () => {
      const url = workflowsUrl("ws#123");
      expect(url).toContain("/api/workspaces/ws%23123/workflows");
    });
  });

  describe("workflowUrl", () => {
    it("builds a workspace-scoped single workflow URL", () => {
      const url = workflowUrl("ws-personal", "wf-1");
      expect(url).toBe(
        `${API_BASE_URL}/api/workspaces/ws-personal/workflows/wf-1`,
      );
    });
  });

  describe("personalWorkflowsUrl", () => {
    it("builds a personal workspace workflow URL with defaults", () => {
      const url = personalWorkflowsUrl("ws-personal");
      expect(url).toBe(
        `${API_BASE_URL}/api/workspaces/ws-personal/workflows?skip=0&limit=20`,
      );
    });
  });

  describe("environmentsUrl", () => {
    it("builds a URL for user-scoped environments", () => {
      const url = environmentsUrl({ scopeType: "user", scopeId: "user-abc" });
      expect(url).toBe(`${API_BASE_URL}/api/users/user-abc/environments`);
    });

    it("builds a URL for organization-scoped environments", () => {
      const url = environmentsUrl({
        scopeType: "organization",
        scopeId: "org-42",
      });
      expect(url).toBe(`${API_BASE_URL}/api/orgs/org-42/environments`);
    });

    it("builds a URL for workspace-scoped environments", () => {
      const url = environmentsUrl({ scopeType: "workspace", scopeId: "ws-1" });
      expect(url).toBe(`${API_BASE_URL}/api/workspaces/ws-1/environments`);
    });

    it("builds a URL for all accessible workspace environments", () => {
      const url = environmentsUrl("ws-1", "all-accessible", "org-1");
      expect(url).toBe(
        `${API_BASE_URL}/api/workspaces/ws-1/environments/all-accessible?org_id=org-1`,
      );
    });
  });

  describe("projectsUrl", () => {
    it("builds a URL for listing all projects in a workspace", () => {
      const url = projectsUrl("ws-1");
      expect(url).toBe(`${API_BASE_URL}/api/workspaces/ws-1/projects`);
    });

    it("builds a URL targeting a specific project", () => {
      const url = projectsUrl("ws-1", "proj-99");
      expect(url).toBe(`${API_BASE_URL}/api/workspaces/ws-1/projects/proj-99`);
    });

    it("builds a scoped project export URL", () => {
      const url = projectExportUrl("ws-1", "proj-99", true);
      expect(url).toBe(
        `${API_BASE_URL}/api/workspaces/ws-1/projects/proj-99/export?include_environment=true`,
      );
    });

    it("builds scoped project import URLs", () => {
      expect(projectImportUrl("ws-1")).toBe(
        `${API_BASE_URL}/api/workspaces/ws-1/projects/import`,
      );
      expect(projectImportUrl("ws-1", true)).toBe(
        `${API_BASE_URL}/api/workspaces/ws-1/projects/import/dry-run`,
      );
    });
  });

  describe("secretsUrl", () => {
    it("builds a URL for workspace-scoped secrets", () => {
      const url = secretsUrl({ scopeType: "workspace", scopeId: "ws-1" });
      expect(url).toBe(`${API_BASE_URL}/api/scopes/workspace/ws-1/secrets`);
    });

    it("builds a URL for user-scoped secrets", () => {
      const url = secretsUrl({ scopeType: "user", scopeId: "user-abc" });
      expect(url).toBe(`${API_BASE_URL}/api/scopes/user/user-abc/secrets`);
    });

    it("builds a URL for environment-scoped secrets", () => {
      const url = secretsUrl({ scopeType: "environment", scopeId: "env-5" });
      expect(url).toBe(`${API_BASE_URL}/api/scopes/environment/env-5/secrets`);
    });
  });
});
