import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrgMembersSection } from '../OrgMembersSection';
import type { OrgMember } from '../../../types';

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

function makeMember(overrides: Partial<OrgMember> = {}): OrgMember {
  return {
    memberId: 'mem-1',
    orgId: 'org-1',
    userId: 'user-aaaaaaaa11111111',
    role: 'owner',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrgMembersSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticatedJson.mockResolvedValue([]);
    mockAuthenticatedFetch.mockResolvedValue(new Response());
  });

  it('shows loading spinner initially', () => {
    mockAuthenticatedJson.mockReturnValue(new Promise(() => {})); // never resolves
    render(<OrgMembersSection orgSlug="acme" orgId="org-1" currentUserId="user-1" />);
    expect(document.querySelector('.loading-spinner')).toBeInTheDocument();
  });

  it('renders member list after loading', async () => {
    const members = [
      makeMember({ memberId: 'm1', userId: 'user-aaaaaaaa11111111', role: 'owner' }),
      makeMember({ memberId: 'm2', userId: 'user-bbbbbbbb22222222', role: 'member' }),
    ];
    mockAuthenticatedJson.mockResolvedValue(members);

    render(<OrgMembersSection orgSlug="acme" orgId="org-1" currentUserId="user-1" />);

    await waitFor(() => {
      expect(screen.getByText('2 members')).toBeInTheDocument();
    });

    // User IDs are truncated to first 8 chars
    expect(screen.getByText('user-aaa…')).toBeInTheDocument();
    expect(screen.getByText('user-bbb…')).toBeInTheDocument();
  });

  it('shows "(you)" indicator for current user', async () => {
    const members = [
      makeMember({ userId: 'user-1aaaaaaa', role: 'owner' }),
    ];
    mockAuthenticatedJson.mockResolvedValue(members);

    render(<OrgMembersSection orgSlug="acme" orgId="org-1" currentUserId="user-1aaaaaaa" />);

    await waitFor(() => {
      expect(screen.getByText('(you)')).toBeInTheDocument();
    });
  });

  it('shows empty state when no members', async () => {
    mockAuthenticatedJson.mockResolvedValue([]);

    render(<OrgMembersSection orgSlug="acme" orgId="org-1" currentUserId="user-1" />);

    await waitFor(() => {
      expect(screen.getByText('No members')).toBeInTheDocument();
    });
  });

  it('disables role selector and shows "Last owner" for sole owner', async () => {
    const members = [
      makeMember({ userId: 'user-aaaaaaaa11111111', role: 'owner' }),
    ];
    mockAuthenticatedJson.mockResolvedValue(members);

    render(<OrgMembersSection orgSlug="acme" orgId="org-1" currentUserId="user-1" />);

    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select).toBeDisabled();
      expect(screen.getByText('Last owner')).toBeInTheDocument();
    });
  });

  it('enables role selector when multiple owners exist', async () => {
    const members = [
      makeMember({ memberId: 'm1', userId: 'user-aaaaaaaa11111111', role: 'owner' }),
      makeMember({ memberId: 'm2', userId: 'user-bbbbbbbb22222222', role: 'owner' }),
    ];
    mockAuthenticatedJson.mockResolvedValue(members);

    render(<OrgMembersSection orgSlug="acme" orgId="org-1" currentUserId="user-1" />);

    await waitFor(() => {
      const selects = screen.getAllByRole('combobox');
      expect(selects).toHaveLength(2);
      selects.forEach((s) => expect(s).not.toBeDisabled());
    });
  });

  it('calls API to change role when select value changes', async () => {
    const user = userEvent.setup();
    const members = [
      makeMember({ memberId: 'm1', userId: 'user-aaaaaaaa11111111', role: 'owner' }),
      makeMember({ memberId: 'm2', userId: 'user-bbbbbbbb22222222', role: 'owner' }),
    ];
    const updatedMember = { ...members[1]!, role: 'member' as const };
    mockAuthenticatedJson
      .mockResolvedValueOnce(members) // initial fetch
      .mockResolvedValueOnce(updatedMember); // role update

    render(<OrgMembersSection orgSlug="acme" orgId="org-1" currentUserId="user-1" />);

    await waitFor(() => {
      expect(screen.getAllByRole('combobox')).toHaveLength(2);
    });

    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[1]!, 'member');

    await waitFor(() => {
      expect(mockAuthenticatedJson).toHaveBeenCalledTimes(2);
    });
  });

  it('opens confirm dialog when remove button is clicked', async () => {
    const user = userEvent.setup();
    const members = [
      makeMember({ memberId: 'm1', userId: 'user-aaaaaaaa11111111', role: 'owner' }),
      makeMember({ memberId: 'm2', userId: 'user-bbbbbbbb22222222', role: 'member' }),
    ];
    mockAuthenticatedJson.mockResolvedValue(members);

    render(<OrgMembersSection orgSlug="acme" orgId="org-1" currentUserId="user-1" />);

    await waitFor(() => {
      expect(screen.getByText('user-bbb…')).toBeInTheDocument();
    });

    // The remove button is the one with tooltip "Remove member"
    const removeButtons = screen.getAllByRole('button', { name: /remove member/i });
    expect(removeButtons.length).toBeGreaterThanOrEqual(1);
    await user.click(removeButtons[0]!);

    await waitFor(() => {
      expect(screen.getByText('Remove Member')).toBeInTheDocument();
    });
  });
});
