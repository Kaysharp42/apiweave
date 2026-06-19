import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrgTeamsSection } from '../OrgTeamsSection';
import type { Team } from '../../../types';

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

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    teamId: 'team-1',
    orgId: 'org-1',
    slug: 'engineering',
    name: 'Engineering',
    description: 'Core engineering team',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrgTeamsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticatedJson.mockResolvedValue([]);
    mockAuthenticatedFetch.mockResolvedValue(new Response());
  });

  it('shows loading spinner initially', () => {
    mockAuthenticatedJson.mockReturnValue(new Promise(() => {}));
    render(<OrgTeamsSection orgSlug="acme" orgId="org-1" />);
    expect(document.querySelector('.loading-spinner')).toBeInTheDocument();
  });

  it('shows empty state when no teams exist', async () => {
    mockAuthenticatedJson.mockResolvedValue([]);
    render(<OrgTeamsSection orgSlug="acme" orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByText('No teams')).toBeInTheDocument();
    });
    expect(screen.getByText('Create Team')).toBeInTheDocument();
  });

  it('renders team list after loading', async () => {
    const teams = [
      makeTeam({ teamId: 't1', name: 'Engineering', slug: 'engineering' }),
      makeTeam({ teamId: 't2', name: 'Design', slug: 'design', description: null }),
    ];
    mockAuthenticatedJson.mockResolvedValue(teams);

    render(<OrgTeamsSection orgSlug="acme" orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByText('Engineering')).toBeInTheDocument();
      expect(screen.getByText('Design')).toBeInTheDocument();
    });
  });

  it('shows team description when present', async () => {
    const teams = [makeTeam({ description: 'Core engineering team' })];
    mockAuthenticatedJson.mockResolvedValue(teams);

    render(<OrgTeamsSection orgSlug="acme" orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByText('Core engineering team')).toBeInTheDocument();
    });
  });

  it('opens create team modal when "New Team" is clicked', async () => {
    const user = userEvent.setup();
    mockAuthenticatedJson.mockResolvedValue([]);

    render(<OrgTeamsSection orgSlug="acme" orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByText('No teams')).toBeInTheDocument();
    });

    await user.click(screen.getByText('New Team'));

    await waitFor(() => {
      expect(screen.getAllByText('Create Team').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByPlaceholderText('Engineering')).toBeInTheDocument();
    });
  });

  it('expands team to show members and permissions on click', async () => {
    const user = userEvent.setup();
    const teams = [makeTeam()];
    mockAuthenticatedJson
      .mockResolvedValueOnce(teams) // initial fetch
      .mockResolvedValueOnce([]) // members
      .mockResolvedValueOnce([]); // grants

    render(<OrgTeamsSection orgSlug="acme" orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByText('Engineering')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Engineering'));

    await waitFor(() => {
      expect(screen.getByText('Members (0)')).toBeInTheDocument();
      expect(screen.getByText('Permissions (0)')).toBeInTheDocument();
    });
  });

  it('collapses team on second click', async () => {
    const user = userEvent.setup();
    const teams = [makeTeam()];
    mockAuthenticatedJson
      .mockResolvedValueOnce(teams)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    render(<OrgTeamsSection orgSlug="acme" orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByText('Engineering')).toBeInTheDocument();
    });

    // Expand
    await user.click(screen.getByText('Engineering'));
    await waitFor(() => {
      expect(screen.getByText('Members (0)')).toBeInTheDocument();
    });

    // Collapse
    await user.click(screen.getByText('Engineering'));
    await waitFor(() => {
      expect(screen.queryByText('Members (0)')).not.toBeInTheDocument();
    });
  });

  it('opens delete confirm dialog when delete button is clicked', async () => {
    const user = userEvent.setup();
    const teams = [makeTeam()];
    mockAuthenticatedJson.mockResolvedValue(teams);

    render(<OrgTeamsSection orgSlug="acme" orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByText('Engineering')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole('button', { name: /delete team/i });
    await user.click(deleteButtons[0]!);

    await waitFor(() => {
      expect(screen.getByText(/Delete team/)).toBeInTheDocument();
    });
  });

  it('calls API to create team when form is submitted', async () => {
    const user = userEvent.setup();
    const createdTeam = makeTeam({ name: 'New Team', slug: 'new-team' });
    mockAuthenticatedJson
      .mockResolvedValueOnce([]) // initial fetch
      .mockResolvedValueOnce(createdTeam); // create

    render(<OrgTeamsSection orgSlug="acme" orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByText('No teams')).toBeInTheDocument();
    });

    await user.click(screen.getByText('New Team'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Engineering')).toBeInTheDocument();
    });

    const nameInput = screen.getByPlaceholderText('Engineering');
    const slugInput = screen.getByPlaceholderText('engineering');
    await user.type(nameInput, 'New Team');
    await user.type(slugInput, 'new-team');

    const createButton = screen.getByText('Create');
    await user.click(createButton);

    await waitFor(() => {
      expect(mockAuthenticatedJson).toHaveBeenCalledTimes(2);
    });
  });
});
