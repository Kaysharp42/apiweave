import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useScopeContext } from "../hooks/useScopeContext";
import type { Workspace } from "../types/Workspace";
import type { Organization } from "../types/Organization";
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
  orgId: null,
  isPersonal: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const orgWorkspace: Workspace = {
  workspaceId: "ws-org-42",
  slug: "engineering",
  name: "Engineering Workspace",
  description: null,
  ownerType: "organization",
  ownerUserId: null,
  orgId: "org-42",
  isPersonal: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const mockOrg: Organization = {
  orgId: "org-42",
  slug: "acme",
  name: "Acme Corp",
  description: null,
  avatarUrl: null,
  ownerUserId: "user-abc",
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
    });
    mockUseAuth.mockReturnValue({ user: null });

    const { result } = renderHook(() => useScopeContext());

    expect(result.current.isReady).toBe(false);
    expect(result.current.workspaceId).toBeNull();
    expect(result.current.workspaceSlug).toBeNull();
    expect(result.current.orgId).toBeNull();
    expect(result.current.orgSlug).toBeNull();
  });

  it("returns isReady=false when currentWorkspace is null", () => {
    mockUseWorkspace.mockReturnValue({
      isLoading: false,
      currentWorkspace: null,
      currentOrg: null,
      orgs: [],
      availableWorkspaces: [],
      currentRole: null,
      switchTo: vi.fn(),
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
    });
    mockUseAuth.mockReturnValue({ user: mockUser });

    const { result } = renderHook(() => useScopeContext());

    expect(result.current.isReady).toBe(true);
    expect(result.current.workspaceId).toBe("ws-personal");
    expect(result.current.workspaceSlug).toBe("personal");
    expect(result.current.orgId).toBeNull();
    expect(result.current.orgSlug).toBeNull();
    expect(result.current.userId).toBe("user-abc");
  });

  it("returns scope context for org workspace", () => {
    mockUseWorkspace.mockReturnValue({
      isLoading: false,
      currentWorkspace: orgWorkspace,
      currentOrg: mockOrg,
      orgs: [mockOrg],
      availableWorkspaces: [],
      currentRole: "write",
      switchTo: vi.fn(),
    });
    mockUseAuth.mockReturnValue({ user: mockUser });

    const { result } = renderHook(() => useScopeContext());

    expect(result.current.isReady).toBe(true);
    expect(result.current.workspaceId).toBe("ws-org-42");
    expect(result.current.workspaceSlug).toBe("engineering");
    expect(result.current.orgId).toBe("org-42");
    expect(result.current.orgSlug).toBe("acme");
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
    });
    mockUseAuth.mockReturnValue({ user: mockUser });

    const { result } = renderHook(() => useScopeContext());

    // userId is derived from auth which may be loaded before workspace
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
    });
    mockUseAuth.mockReturnValue({ user: null });

    const { result } = renderHook(() => useScopeContext());

    expect(result.current.isReady).toBe(true);
    expect(result.current.userId).toBeNull();
  });
});
