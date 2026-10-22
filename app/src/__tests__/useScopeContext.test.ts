import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useScopeContext } from "../hooks/useScopeContext";
import type { Workspace } from "../types/Workspace";
import type { WorkspaceContextValue } from "../types/WorkspaceContextValue";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUseWorkspace = vi.fn<() => WorkspaceContextValue>();

vi.mock("../contexts/WorkspaceContext", () => ({
  useWorkspace: () => mockUseWorkspace(),
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const personalWorkspace: Workspace = {
  workspaceId: "ws-personal",
  slug: "personal",
  name: "Personal Workspace",
  description: null,
  isPersonal: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useScopeContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns isReady=false while WorkspaceContext is loading", () => {
    mockUseWorkspace.mockReturnValue({
      isLoading: true,
      currentWorkspace: null,
      currentOrg: null,
      orgs: [],
      availableWorkspaces: [],
      switchTo: vi.fn(),
      refresh: vi.fn(),
    });

    const { result } = renderHook(() => useScopeContext());

    expect(result.current.isReady).toBe(false);
    expect(result.current.workspaceId).toBeNull();
    expect(result.current.workspaceSlug).toBeNull();
  });

  it("returns isReady=false when currentWorkspace is null", () => {
    mockUseWorkspace.mockReturnValue({
      isLoading: true,
      currentWorkspace: null,
      currentOrg: null,
      orgs: [],
      availableWorkspaces: [],
      switchTo: vi.fn(),
      refresh: vi.fn(),
    });

    const { result } = renderHook(() => useScopeContext());

    expect(result.current.isReady).toBe(false);
    expect(result.current.workspaceId).toBeNull();
  });

  it("returns scope context for personal workspace", () => {
    mockUseWorkspace.mockReturnValue({
      isLoading: false,
      currentWorkspace: personalWorkspace,
      currentOrg: null,
      orgs: [],
      availableWorkspaces: [],
      switchTo: vi.fn(),
      refresh: vi.fn(),
    });

    const { result } = renderHook(() => useScopeContext());

    expect(result.current.isReady).toBe(true);
    expect(result.current.workspaceId).toBe("ws-personal");
    expect(result.current.workspaceSlug).toBe("personal");
  });
});
