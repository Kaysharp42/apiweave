import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrgInvitesSection } from '../OrgInvitesSection';
import type { OrgInvite } from '../../../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAuthenticatedJson = vi.fn();
const mockAuthenticatedFetch = vi.fn();

vi.mock('../../../utils/authenticatedApi', () => ({
  authenticatedJson: (...args: unknown[]) => mockAuthenticatedJson(...args),
  authenticatedFetch: (...args: unknown[]) => mockAuthenticatedFetch(...args),
}));

vi.mock('../../../utils/api', () => ({ default: 'http://localhost:8000' }));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInvite(overrides: Partial<OrgInvite> = {}): OrgInvite {
  return {
    inviteId: 'inv-1',
    orgId: 'org-1',
    email: 'alice@example.com',
    role: 'member',
    invited_by: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    expires_at: '2026-02-01T00:00:00Z',
    consumed: false,
    consumed_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrgInvitesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticatedJson.mockResolvedValue([]);
    mockAuthenticatedFetch.mockResolvedValue(new Response());
  });

  it('shows loading spinner initially', () => {
    mockAuthenticatedJson.mockReturnValue(new Promise(() => {}));
    render(<OrgInvitesSection orgSlug="acme" orgId="org-1" />);
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows empty state when no pending invites', async () => {
    mockAuthenticatedJson.mockResolvedValue([]);
    render(<OrgInvitesSection orgSlug="acme" orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByText('No pending invites')).toBeInTheDocument();
    });
  });

  it('renders pending invites in a table', async () => {
    const invites = [
      makeInvite({ inviteId: 'inv-1', email: 'alice@example.com', role: 'member' }),
      makeInvite({ inviteId: 'inv-2', email: 'bob@example.com', role: 'billing' }),
    ];
    mockAuthenticatedJson.mockResolvedValue(invites);

    render(<OrgInvitesSection orgSlug="acme" orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
      expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    });
  });

  it('filters out consumed invites', async () => {
    const invites = [
      makeInvite({ email: 'active@example.com', consumed: false }),
      makeInvite({ inviteId: 'inv-2', email: 'consumed@example.com', consumed: true }),
    ];
    mockAuthenticatedJson.mockResolvedValue(invites);

    render(<OrgInvitesSection orgSlug="acme" orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByText('active@example.com')).toBeInTheDocument();
      expect(screen.queryByText('consumed@example.com')).not.toBeInTheDocument();
    });
  });

  it('opens invite modal when "Invite" button is clicked', async () => {
    const user = userEvent.setup();
    mockAuthenticatedJson.mockResolvedValue([]);

    render(<OrgInvitesSection orgSlug="acme" orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByText('No pending invites')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Invite'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('member@example.com')).toBeInTheDocument();
    });
  });

  it('calls API to create invite when form is submitted', async () => {
    const user = userEvent.setup();
    mockAuthenticatedJson
      .mockResolvedValueOnce([]) // initial fetch
      .mockResolvedValueOnce({
        inviteId: 'inv-new',
        orgId: 'org-1',
        email: 'new@example.com',
        role: 'member',
        token: 'one-time-token',
        expires_at: '2026-02-01T00:00:00Z',
      }) // create
      .mockResolvedValueOnce([]); // refresh after create

    render(<OrgInvitesSection orgSlug="acme" orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByText('No pending invites')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Invite'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('member@example.com')).toBeInTheDocument();
    });

    const emailInput = screen.getByPlaceholderText('member@example.com');
    await user.type(emailInput, 'new@example.com');

    await user.click(screen.getByText('Send Invite'));

    await waitFor(() => {
      // After creation, the success state should show
      expect(screen.getByText(/Invite sent to/)).toBeInTheDocument();
    });
  });

  it('shows success confirmation with email after invite creation', async () => {
    const user = userEvent.setup();
    mockAuthenticatedJson
      .mockResolvedValueOnce([]) // initial fetch
      .mockResolvedValueOnce({
        inviteId: 'inv-new',
        orgId: 'org-1',
        email: 'test@example.com',
        role: 'member',
        token: 'one-time-token',
        expires_at: '2026-02-01T00:00:00Z',
      })
      .mockResolvedValueOnce([]); // refresh

    render(<OrgInvitesSection orgSlug="acme" orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByText('No pending invites')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Invite'));
    await user.type(screen.getByPlaceholderText('member@example.com'), 'test@example.com');
    await user.click(screen.getByText('Send Invite'));

    await waitFor(() => {
      expect(screen.getByText('test@example.com')).toBeInTheDocument();
    });
  });
});
