import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import WorkspaceEnvironmentsPage from '../../../pages/WorkspaceEnvironmentsPage';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAuthenticatedJson = vi.fn();

vi.mock('../utils/authenticatedApi', () => ({
  authenticatedJson: (...args: unknown[]) => mockAuthenticatedJson(...args),
}));

vi.mock('../utils/api', () => ({ default: 'http://localhost:8000' }));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ orgSlug: 'acme', workspaceSlug: 'main' }),
  };
});

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    user: {
      userId: 'user-1',
      verified_email: 'alice@example.com',
      roles: ['member'],
      permissions: [],
    },
    status: 'authenticated',
    error: null,
    isLoading: false,
    isAuthenticated: true,
    isSetupComplete: true,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    hasPermission: vi.fn(() => false),
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceEnvironmentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: resolve IDs + return empty env lists
    mockAuthenticatedJson
      .mockResolvedValueOnce({ orgId: 'org-1' }) // resolve org slug
      .mockResolvedValueOnce({ workspaceId: 'ws-1' }) // resolve workspace slug
      .mockResolvedValueOnce([]) // user envs
      .mockResolvedValueOnce([]) // org envs
      .mockResolvedValueOnce([]) // workspace envs
      .mockResolvedValueOnce([]) // pending approvals
      .mockResolvedValueOnce([]); // org workspaces
  });

  it('shows loading spinner initially', () => {
    mockAuthenticatedJson.mockReturnValue(new Promise(() => {}));
    render(<WorkspaceEnvironmentsPage />);
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('renders page header with title', async () => {
    render(<WorkspaceEnvironmentsPage />);

    await waitFor(() => {
      expect(screen.getByText('Environments')).toBeInTheDocument();
    });
  });

  it('shows breadcrumb with org/workspace slugs', async () => {
    render(<WorkspaceEnvironmentsPage />);

    await waitFor(() => {
      expect(screen.getByText('acme / main')).toBeInTheDocument();
    });
  });

  it('renders "New Environment" button', async () => {
    render(<WorkspaceEnvironmentsPage />);

    await waitFor(() => {
      expect(screen.getByText('New Environment')).toBeInTheDocument();
    });
  });

  it('renders scope-grouped environment lists', async () => {
    render(<WorkspaceEnvironmentsPage />);

    await waitFor(() => {
      expect(screen.getByText('Workspace Environments')).toBeInTheDocument();
      expect(screen.getByText('Organization Environments')).toBeInTheDocument();
      expect(screen.getByText('User Environments')).toBeInTheDocument();
    });
  });

  it('shows "Select an environment" empty state when no env is selected', async () => {
    render(<WorkspaceEnvironmentsPage />);

    await waitFor(() => {
      expect(screen.getByText('Select an environment')).toBeInTheDocument();
    });
  });

  it('resolves slug to IDs via API', async () => {
    render(<WorkspaceEnvironmentsPage />);

    await waitFor(() => {
      // The first two calls should be slug resolution
      expect(mockAuthenticatedJson).toHaveBeenCalledWith(
        expect.stringContaining('/api/orgs/by-slug/acme'),
      );
      expect(mockAuthenticatedJson).toHaveBeenCalledWith(
        expect.stringContaining('/api/workspaces/by-slug/main'),
      );
    });
  });
});
