import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EnvironmentProtectionPanel } from '../EnvironmentProtectionPanel';
import type { EnvironmentProtectionPanelProps } from '../../../types';
import type { EnvironmentProtectionPolicy } from '../../../types/EnvironmentProtectionPolicy';
import type { ReviewerOption } from '../../../types/ReviewerSelectorProps';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProtection(overrides: Partial<EnvironmentProtectionPolicy> = {}): EnvironmentProtectionPolicy {
  return {
    protectionId: 'prot-1',
    environmentId: 'env-1',
    requiredReviewers: ['user-1'],
    allowSelfApproval: false,
    bypassPolicy: 'none',
    bypassAllowlist: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const reviewerOptions: ReviewerOption[] = [
  { id: 'user-1', name: 'Alice', type: 'user' },
  { id: 'user-2', name: 'Bob', type: 'user' },
  { id: 'team-1', name: 'Backend Team', type: 'team' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EnvironmentProtectionPanel', () => {
  const mockOnSave = vi.fn();
  const mockOnRemove = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderPanel(overrides: Partial<EnvironmentProtectionPanelProps> = {}) {
    const props: EnvironmentProtectionPanelProps = {
      environmentId: 'env-1',
      protection: null,
      reviewerOptions,
      onSave: mockOnSave,
      onRemove: mockOnRemove,
      saving: false,
      ...overrides,
    };
    return render(<EnvironmentProtectionPanel {...props} />);
  }

  it('renders "Enable Protection" when no protection exists', () => {
    renderPanel({ protection: null });
    expect(screen.getByText('Enable Protection')).toBeInTheDocument();
    expect(screen.getByText('Environment Protection')).toBeInTheDocument();
  });

  it('renders "Update Protection" when protection exists', () => {
    renderPanel({ protection: makeProtection() });
    expect(screen.getByText('Update Protection')).toBeInTheDocument();
    expect(screen.getByText('Remove Protection')).toBeInTheDocument();
  });

  it('shows self-approval toggle', () => {
    renderPanel({ protection: null });
    expect(screen.getByText('Allow Self-Approval')).toBeInTheDocument();
    expect(
      screen.getByText('Let the person who triggered the run also approve it'),
    ).toBeInTheDocument();
  });

  it('shows bypass policy selector', () => {
    renderPanel({ protection: null });
    expect(screen.getByText('Bypass Policy')).toBeInTheDocument();
    const select = screen.getByDisplayValue('None — approval always required');
    expect(select).toBeInTheDocument();
  });

  it('shows bypass allowlist when policy is trusted_token_only', () => {
    renderPanel({
      protection: makeProtection({ bypassPolicy: 'trusted_token_only' }),
    });
    expect(screen.getByText('Bypass Allowlist')).toBeInTheDocument();
    expect(screen.getByText('No tokens in allowlist. Add service token IDs below.')).toBeInTheDocument();
  });

  it('does not show bypass allowlist when policy is none', () => {
    renderPanel({ protection: makeProtection({ bypassPolicy: 'none' }) });
    expect(screen.queryByText('Bypass Allowlist')).not.toBeInTheDocument();
  });

  it('shows existing bypass tokens in allowlist', () => {
    renderPanel({
      protection: makeProtection({
        bypassPolicy: 'trusted_token_only',
        bypassAllowlist: ['token-abc', 'token-xyz'],
      }),
    });
    expect(screen.getByText('token-abc')).toBeInTheDocument();
    expect(screen.getByText('token-xyz')).toBeInTheDocument();
  });

  it('displays required reviewers label', () => {
    renderPanel({ protection: null });
    expect(screen.getByText('Required Reviewers')).toBeInTheDocument();
  });

  it('disables save button when no changes and protection exists', () => {
    renderPanel({ protection: makeProtection() });
    const saveButton = screen.getByText('Update Protection');
    expect(saveButton.closest('button')).toBeDisabled();
  });

  it('shows saving state when saving prop is true', () => {
    renderPanel({ saving: true });
    // The button should have a loading state (disabled)
    const saveButton = screen.getByText('Enable Protection');
    expect(saveButton.closest('button')).toBeDisabled();
  });
});
