import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EnvironmentSelector from '../components/EnvironmentSelector';
import EnvironmentManager from '../components/EnvironmentManager';
import API_BASE_URL from '../utils/api';
import { authenticatedFetch } from '../utils/authenticatedApi';

vi.mock('../utils/authenticatedApi', () => ({
  authenticatedFetch: vi.fn(),
}));

vi.mock('../hooks/useScopeContext', () => ({
  useScopeContext: () => ({
    workspaceId: 'ws-1',
    workspaceSlug: 'workspace-one',
    orgId: 'org-1',
    orgSlug: 'org-one',
    userId: 'user-1',
    isReady: true,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockAuthenticatedFetch = vi.mocked(authenticatedFetch);

function okJsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

describe('scoped environment routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticatedFetch.mockResolvedValue(okJsonResponse([]));
  });

  it('loads selector environments from the workspace all-accessible route', async () => {
    const user = userEvent.setup();

    render(<EnvironmentSelector onManageClick={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /environments/i }));

    await waitFor(() => {
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/api/workspaces/ws-1/environments/all-accessible?org_id=org-1`,
      );
    });
    expect(mockAuthenticatedFetch.mock.calls.map(([url]) => url)).not.toContain(
      `${API_BASE_URL}/api/environments`,
    );
  });

  it('creates workspace environments through the scoped workspace route', async () => {
    const user = userEvent.setup();
    mockAuthenticatedFetch
      .mockResolvedValueOnce(okJsonResponse([]))
      .mockResolvedValueOnce(okJsonResponse({ environmentId: 'env-staging' }))
      .mockResolvedValueOnce(okJsonResponse([]));

    render(<EnvironmentManager open={true} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /new environment/i }));
    await user.type(screen.getByLabelText(/^name$/i), 'Staging');
    await user.type(screen.getByPlaceholderText(/variable name/i), 'BASE_URL');
    await user.type(screen.getByPlaceholderText(/value/i), 'https://example.test');
    await user.click(screen.getByRole('button', { name: /^add$/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/api/workspaces/ws-1/environments`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'Staging',
            description: '',
            swaggerDocUrl: '',
            variables: { BASE_URL: 'https://example.test' },
          }),
        }),
      );
    });
  });
});
