/**
 * Task 13: Personal workspace boot — network audit.
 *
 * Mounts the /personal/workflows route and captures every fetch call
 * during the boot sequence. Asserts that NO request uses a legacy
 * flat API URL (/api/workflows, /api/environments, /api/collections).
 *
 * All requests must use scoped workspace URLs after the migration.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Sidebar } from "../components/layout/Sidebar";
import useSidebarStore from "../stores/SidebarStore";
import type { ScopeContext } from "../types";

const capturedUrls: string[] = [];

vi.mock("../utils/authenticatedApi", () => ({
  authenticatedFetch: vi.fn((url: string) => {
    capturedUrls.push(url);
    if (url.includes("/workflows")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ workflows: [], total: 0 }),
      });
    }
    if (url.includes("/projects")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ projects: [], total: 0 }),
      });
    }
    if (url.includes("/environments")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      });
    }
    if (url.includes("/collections")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  }),
}));

vi.mock("../hooks/useScopeContext", () => ({
  useScopeContext: (): ScopeContext => ({
    workspaceId: "ws-personal-123",
    workspaceSlug: "personal",
    orgId: null,
    orgSlug: null,
    userId: "user-1",
    isReady: true,
  }),
}));

vi.mock("../auth/useAuth", () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("../components/layout/SidebarHeader", () => ({
  SidebarHeader: () => null,
}));

vi.mock("../components/layout/sidebar/WorkflowList", () => ({
  WorkflowList: () => null,
}));

vi.mock("../components/layout/sidebar/ProjectList", () => ({
  ProjectList: () => null,
}));

vi.mock("../components/layout/sidebar/SettingsContent", () => ({
  SettingsContent: () => null,
}));

vi.mock("../components/CollectionManager", () => ({ default: () => null }));
vi.mock("../components/WebhookManager", () => ({ default: () => null }));
vi.mock("../components/MCPManager", () => ({ default: () => null }));
vi.mock("../components/WorkflowExportImport", () => ({ default: () => null }));
vi.mock("../components/CollectionExportImport", () => ({
  default: () => null,
}));

const LEGACY_URL_PATTERN = /\/api\/(workflows|environments|collections)(\/|$)/;

describe("Task 13: Personal workspace boot — no legacy URLs", () => {
  beforeEach(() => {
    capturedUrls.length = 0;
    useSidebarStore.setState({ activeWorkspaceId: "ws-personal-123" });
  });

  it("must NOT fetch from legacy flat API routes during /personal/workflows boot", async () => {
    render(
      <MemoryRouter initialEntries={["/personal/workflows"]}>
        <Routes>
          <Route path="/personal/workflows" element={<Sidebar />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(
      () => {
        expect(capturedUrls.length).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );

    const legacyMatches = capturedUrls.filter((url) =>
      LEGACY_URL_PATTERN.test(url),
    );

    expect(
      legacyMatches,
      `Found ${legacyMatches.length} legacy URL(s) in boot fetches:\n${legacyMatches.join("\n")}`,
    ).toHaveLength(0);
  });

  it("all boot fetches must use scoped workspace URLs", async () => {
    render(
      <MemoryRouter initialEntries={["/personal/workflows"]}>
        <Routes>
          <Route path="/personal/workflows" element={<Sidebar />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(
      () => {
        expect(capturedUrls.length).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );

    for (const url of capturedUrls) {
      if (
        url.includes("/api/workspaces/") ||
        url.includes("/api/scopes/") ||
        url.includes("/api/orgs") ||
        url.includes("/api/users/")
      ) {
        continue;
      }
      if (
        url.includes("/api/me") ||
        url.includes("/api/auth") ||
        url.includes("/api/csrf")
      ) {
        continue;
      }
      expect(url, `Boot fetch URL does not use scoped pattern: ${url}`).toMatch(
        /\/api\/(workspaces|scopes|orgs|users|me|auth|csrf)/,
      );
    }
  });
});
