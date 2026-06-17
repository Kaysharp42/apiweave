import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrgWorkspaceSwitcher } from '../OrgWorkspaceSwitcher';
import type { WorkspaceContextValue, WorkspaceEntry } from '../../../types';
import type { Organization } from '../../../types/Organization';
import type { Workspace } from '../../../types/Workspace';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSwitchTo = vi.fn();

const defaultContext: WorkspaceContextValue = {
  orgs: [],
  availableWorkspaces: [],
  currentOrg: null,
  currentWorkspace: null,
  currentRole: null,
  switchTo: mockSwitchTo,
  isLoading: false,
};

vi.mock('../../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => defaultContext,
}));

function setContext(overrides: Partial<WorkspaceContextValue>): void {
  Object.assign(defaultContext, overrides);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOrg(overrides: Partial<Organization> = {}): Organization {
  return {
    orgId: 'org-1',
    slug: 'acme',
    name: 'Acme Corp',
    description: null,
    avatarUrl: null,
    ownerUserId: 'user-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    workspaceId: 'ws-1',
    slug: 'default',
    name: 'Default',
    description: null,
    ownerType: 'user',
    ownerUserId: 'user-1',
    orgId: null,
    isPersonal: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeEntry(
  org: Organization | null,
  ws: Workspace,
  role = 'owner',
): WorkspaceEntry {
  return { org, workspace: ws, role };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrgWorkspaceSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setContext({
      orgs: [],
      availableWorkspaces: [],
      currentOrg: null,
      currentWorkspace: null,
      currentRole: null,
      isLoading: false,
    });
  });

  it('shows loading skeleton when isLoading is true', () => {
    setContext({ isLoading: true });
    const { container } = render(<OrgWorkspaceSwitcher />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders trigger button with personal label when no org is selected', () => {
    const personalWs = makeWorkspace({ name: 'Personal' });
    setContext({
      availableWorkspaces: [makeEntry(null, personalWs)],
      currentWorkspace: personalWs,
    });
    render(<OrgWorkspaceSwitcher />);
    expect(screen.getByLabelText('Switch workspace')).toBeInTheDocument();
    expect(screen.getByText('Personal')).toBeInTheDocument();
  });

  it('renders trigger with org/workspace label when org is selected', () => {
    const org = makeOrg({ name: 'Acme Corp' });
    const ws = makeWorkspace({ name: 'Production' });
    setContext({
      currentOrg: org,
      currentWorkspace: ws,
    });
    render(<OrgWorkspaceSwitcher />);
    expect(screen.getByText('Acme Corp / Production')).toBeInTheDocument();
  });

  it('opens dropdown on trigger click and shows workspaces', async () => {
    const user = userEvent.setup();
    const personalWs = makeWorkspace({ name: 'Personal', isPersonal: true });
    const org = makeOrg({ name: 'Acme Corp' });
    const orgWs = makeWorkspace({
      workspaceId: 'ws-2',
      slug: 'main',
      name: 'Main',
      isPersonal: false,
      orgId: 'org-1',
    });
    setContext({
      orgs: [org],
      availableWorkspaces: [makeEntry(null, personalWs), makeEntry(org, orgWs)],
      currentWorkspace: personalWs,
    });

    render(<OrgWorkspaceSwitcher />);
    await user.click(screen.getByLabelText('Switch workspace'));

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    expect(screen.getByText('Personal')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Main')).toBeInTheDocument();
  });

  it('calls switchTo when a workspace option is clicked', async () => {
    const user = userEvent.setup();
    const personalWs = makeWorkspace({ isPersonal: true });
    const org = makeOrg({ slug: 'acme' });
    const orgWs = makeWorkspace({
      workspaceId: 'ws-2',
      slug: 'main',
      name: 'Main',
      isPersonal: false,
      orgId: 'org-1',
    });
    setContext({
      orgs: [org],
      availableWorkspaces: [makeEntry(null, personalWs), makeEntry(org, orgWs)],
      currentWorkspace: personalWs,
    });

    render(<OrgWorkspaceSwitcher />);
    await user.click(screen.getByLabelText('Switch workspace'));

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    const mainOption = screen.getByText('Main');
    await user.click(mainOption);

    expect(mockSwitchTo).toHaveBeenCalledWith('acme', 'main');
  });

  it('closes dropdown on Escape key', async () => {
    const user = userEvent.setup();
    const personalWs = makeWorkspace({ isPersonal: true });
    setContext({
      availableWorkspaces: [makeEntry(null, personalWs)],
      currentWorkspace: personalWs,
    });

    render(<OrgWorkspaceSwitcher />);
    await user.click(screen.getByLabelText('Switch workspace'));

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  it('shows "No workspaces available" when list is empty', async () => {
    const user = userEvent.setup();
    setContext({ availableWorkspaces: [] });

    render(<OrgWorkspaceSwitcher />);
    await user.click(screen.getByLabelText('Switch workspace'));

    await waitFor(() => {
      expect(screen.getByText('No workspaces available')).toBeInTheDocument();
    });
  });

  it('marks the active workspace with aria-selected', async () => {
    const user = userEvent.setup();
    const personalWs = makeWorkspace({ isPersonal: true });
    setContext({
      availableWorkspaces: [makeEntry(null, personalWs)],
      currentWorkspace: personalWs,
    });

    render(<OrgWorkspaceSwitcher />);
    await user.click(screen.getByLabelText('Switch workspace'));

    await waitFor(() => {
      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveAttribute('aria-selected', 'true');
    });
  });
});
