import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useScopeContext } from "../hooks/useScopeContext";
import type { Workspace } from "../types/Workspace";
import type { User } from "../types/User";
import type { WorkspaceContextValue } from "../types/WorkspaceContextValue";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUseWorkspace = vi.fn<() => WorkspaceContextValue>();
const mockUseAuth = vi.fn<() => { user: User | null }>();

vi.mock("../contexts/WorkspaceContext", () => ({
  useWorkspace: () => mockUseWorkspace(),
}));

vi.mock("../auth/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const personalWorkspace: Workspace = {
  workspaceId: "ws-personal",
  slug: "personal",
  name: "Personal Workspace",
  description: null,
  ownerType: "user",
  ownerUserId: "user-abc",
  isPersonal: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const mockUser: User = {
  userId: "user-abc",
  verified_email: "user@acme.com",
  display_name: "Alice",
  avatar_url: null,
  roles: ["admin"],
  permissions: [],
  oauth_accounts: [],
  is_setup_complete: true,
  created_at: "2026-01-01T00:00:00Z",
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
      currentRole: null,
      switchTo: vi.fn(),
      refresh: vi.fn(),
    });
    mockUseAuth.mockReturnValue({ user: null });

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
      currentRole: null,
      switchTo: vi.fn(),
      refresh: vi.fn(),
    });
    mockUseAuth.mockReturnValue({ user: null });

    const { result } = renderHook(() => useScopeContext());

    expect(result.current.isReady).toBe(false);
    expect(result.current.workspaceId).toBeNull();
  });

  it("returns scope context for personal workspace with user", () => {
    mockUseWorkspace.mockReturnValue({
      isLoading: false,
      currentWorkspace: personalWorkspace,
      currentOrg: null,
      orgs: [],
      availableWorkspaces: [],
      currentRole: "owner",
      switchTo: vi.fn(),
      refresh: vi.fn(),
    });
    mockUseAuth.mockReturnValue({ user: mockUser });

    const { result } = renderHook(() => useScopeContext());

    expect(result.current.isReady).toBe(true);
    expect(result.current.workspaceId).toBe("ws-personal");
    expect(result.current.workspaceSlug).toBe("personal");
    expect(result.current.userId).toBe("user-abc");
  });

  it("exposes userId even when workspace is loading", () => {
    mockUseWorkspace.mockReturnValue({
      isLoading: true,
      currentWorkspace: null,
      currentOrg: null,
      orgs: [],
      availableWorkspaces: [],
      currentRole: null,
      switchTo: vi.fn(),
      refresh: vi.fn(),
    });
    mockUseAuth.mockReturnValue({ user: mockUser });

    const { result } = renderHook(() => useScopeContext());

    expect(result.current.isReady).toBe(false);
    expect(result.current.userId).toBe("user-abc");
  });

  it("returns null userId when user is not authenticated", () => {
    mockUseWorkspace.mockReturnValue({
      isLoading: false,
      currentWorkspace: personalWorkspace,
      currentOrg: null,
      orgs: [],
      availableWorkspaces: [],
      currentRole: "owner",
      switchTo: vi.fn(),
      refresh: vi.fn(),
    });
    mockUseAuth.mockReturnValue({ user: null });

    const { result } = renderHook(() => useScopeContext());

    expect(result.current.isReady).toBe(true);
    expect(result.current.userId).toBeNull();
  });
});
