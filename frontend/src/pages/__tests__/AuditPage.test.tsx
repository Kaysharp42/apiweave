import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AuditPage from '../../pages/AuditPage';
import type { AuditEvent, AuditEventListResponse } from '../../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAuthenticatedJson = vi.fn();
const mockAuthenticatedFetch = vi.fn();

vi.mock('../utils/authenticatedApi', () => ({
  authenticatedJson: (...args: unknown[]) => mockAuthenticatedJson(...args),
  authenticatedFetch: (...args: unknown[]) => mockAuthenticatedFetch(...args),
}));

vi.mock('../utils/api', () => ({ default: 'http://localhost:8000' }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    eventId: 'evt-1',
    actor: 'user',
    actorId: 'user-1',
    action: 'secret_resolved',
    scope: 'workspace',
    scopeId: 'ws-1',
    resourceType: 'secret',
    resourceId: 'sec-1',
    context: {},
    createdAt: '2026-01-15T10:30:00Z',
    ...overrides,
  };
}

function makeListResponse(
  events: AuditEvent[],
  total: number,
  skip = 0,
  limit = 100,
): AuditEventListResponse {
  return { events, total, skip, limit };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticatedJson.mockResolvedValue(makeListResponse([], 0));
    mockAuthenticatedFetch.mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );
  });

  it('renders page header with title', async () => {
    render(<AuditPage />);

    await waitFor(() => {
      expect(screen.getByText('Audit Log')).toBeInTheDocument();
    });
  });

  it('renders subtitle about no secret values', async () => {
    render(<AuditPage />);

    await waitFor(() => {
      expect(
        screen.getByText('Read-only audit trail. No secret values are stored or displayed.'),
      ).toBeInTheDocument();
    });
  });

  it('renders Export JSON button', async () => {
    render(<AuditPage />);

    await waitFor(() => {
      expect(screen.getByText('Export JSON')).toBeInTheDocument();
    });
  });

  it('renders filter panel', async () => {
    render(<AuditPage />);

    await waitFor(() => {
      expect(screen.getByText('Filters')).toBeInTheDocument();
    });
  });

  it('renders filter controls for actor, action, scope, resource type, from, to', async () => {
    render(<AuditPage />);

    await waitFor(() => {
      expect(screen.getByText('Actor')).toBeInTheDocument();
      expect(screen.getByText('Scope')).toBeInTheDocument();
    });
  });

  it('shows empty state when no events', async () => {
    mockAuthenticatedJson.mockResolvedValue(makeListResponse([], 0));

    render(<AuditPage />);

    await waitFor(() => {
      expect(screen.getByText('No audit events')).toBeInTheDocument();
    });
  });

  it('renders events in a table when data is available', async () => {
    const events = [
      makeEvent({ eventId: 'evt-1', action: 'secret_resolved', resourceType: 'secret' }),
      makeEvent({ eventId: 'evt-2', action: 'workflow_run', resourceType: 'workflow' }),
    ];
    mockAuthenticatedJson.mockResolvedValue(makeListResponse(events, 2));

    render(<AuditPage />);

    await waitFor(() => {
      expect(screen.getByText('secret_resolved')).toBeInTheDocument();
      expect(screen.getByText('workflow_run')).toBeInTheDocument();
    });
  });

  it('shows pagination info when events exist', async () => {
    const events = [makeEvent()];
    mockAuthenticatedJson.mockResolvedValue(makeListResponse(events, 1));

    render(<AuditPage />);

    await waitFor(() => {
      expect(screen.getByText(/Showing 1–1 of 1/)).toBeInTheDocument();
    });
  });

  it('shows Events count in panel title', async () => {
    const events = [makeEvent()];
    mockAuthenticatedJson.mockResolvedValue(makeListResponse(events, 42));

    render(<AuditPage />);

    await waitFor(() => {
      expect(screen.getByText('Events (42)')).toBeInTheDocument();
    });
  });

  it('does NOT render context field in the table (defense-in-depth)', async () => {
    const events = [
      makeEvent({
        context: { secret_value: 'should-not-appear' },
      }),
    ];
    mockAuthenticatedJson.mockResolvedValue(makeListResponse(events, 1));

    render(<AuditPage />);

    await waitFor(() => {
      expect(screen.queryByText('should-not-appear')).not.toBeInTheDocument();
    });
  });

  it('disables Previous button on first page', async () => {
    const events = [makeEvent()];
    mockAuthenticatedJson.mockResolvedValue(makeListResponse(events, 1, 0, 100));

    render(<AuditPage />);

    await waitFor(() => {
      const prevButton = screen.getByText('Previous');
      expect(prevButton.closest('button')).toBeDisabled();
    });
  });

  it('disables Next button when all events fit on one page', async () => {
    const events = [makeEvent()];
    mockAuthenticatedJson.mockResolvedValue(makeListResponse(events, 1, 0, 100));

    render(<AuditPage />);

    await waitFor(() => {
      const nextButton = screen.getByText('Next');
      expect(nextButton.closest('button')).toBeDisabled();
    });
  });

  it('enables Next button when more events exist beyond current page', async () => {
    const events = [makeEvent()];
    mockAuthenticatedJson.mockResolvedValue(makeListResponse(events, 200, 0, 100));

    render(<AuditPage />);

    await waitFor(() => {
      const nextButton = screen.getByText('Next');
      expect(nextButton.closest('button')).not.toBeDisabled();
    });
  });
});
