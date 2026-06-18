import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import API_BASE_URL from '../utils/api';
import { Sidebar } from '../components/layout/Sidebar';
import useSidebarStore from '../stores/SidebarStore';
import useTabStore from '../stores/TabStore';
import { requestWorkflowDeletion } from '../utils/sidebarDeletion';
import type { ConfirmDialogProps, PromptDialogProps, ScopeContext, Workflow, WorkflowListProps } from '../types';
import type { authenticatedFetch } from '../utils/authenticatedApi';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  useScopeContext: vi.fn<() => ScopeContext>(),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock('../hooks/useScopeContext', () => ({
  useScopeContext: () => mocks.useScopeContext(),
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

vi.mock('../components/layout/SidebarHeader', () => ({
  SidebarHeader: ({ onCreateNew }: { onCreateNew: () => void }) => (
    <button type="button" onClick={onCreateNew}>new workflow</button>
  ),
}));

vi.mock('../components/layout/sidebar/WorkflowList', () => ({
  WorkflowList: (props: WorkflowListProps) => {
    const workflow: Workflow = {
      workflowId: 'wf-open',
      name: 'Open Me',
      nodes: [],
      edges: [],
      variables: [],
      createdAt: '2026-06-18T00:00:00Z',
      updatedAt: '2026-06-18T00:00:00Z',
    };

    return (
      <div>
        <button type="button" onClick={props.onCreateWorkflow}>show create workflow</button>
        <button type="button" onClick={() => props.onWorkflowClick(workflow)}>open workflow</button>
        <button type="button" onClick={() => props.onDeleteWorkflow('wf-delete', 'Delete Me')}>queue delete workflow</button>
      </div>
    );
  },
}));

vi.mock('../components/layout/sidebar/ProjectList', () => ({
  ProjectList: () => null,
}));

vi.mock('../components/layout/sidebar/SettingsContent', () => ({
  SettingsContent: () => null,
}));

vi.mock('../components/CollectionManager', () => ({ default: () => null }));
vi.mock('../components/WebhookManager', () => ({ default: () => null }));
vi.mock('../components/MCPManager', () => ({ default: () => null }));
vi.mock('../components/WorkflowExportImport', () => ({ default: () => null }));
vi.mock('../components/CollectionExportImport', () => ({ default: () => null }));

vi.mock('../components/molecules/PromptDialog', () => ({
  PromptDialog: ({ open, onSubmit }: PromptDialogProps) => (
    open ? <button type="button" onClick={() => onSubmit('Scoped Smoke')}>submit workflow prompt</button> : null
  ),
}));

vi.mock('../components/molecules/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, onConfirm, title }: ConfirmDialogProps) => (
    open ? <button type="button" onClick={onConfirm}>confirm {title}</button> : null
  ),
}));

function makeWorkflow(workflowId: string, name: string): Workflow {
  return {
    workflowId,
    name,
    nodes: [],
    edges: [],
    variables: [],
    createdAt: '2026-06-18T00:00:00Z',
    updatedAt: '2026-06-18T00:00:00Z',
  };
}

function scopeContext(workspaceId: string | null, isReady: boolean): ScopeContext {
  return {
    workspaceId,
    workspaceSlug: workspaceId ? 'personal' : null,
    orgId: null,
    orgSlug: null,
    userId: 'user-1',
    isReady,
  };
}

function responseJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function methodFrom(init: RequestInit | undefined): string {
  return (init?.method ?? 'GET').toUpperCase();
}

function resetStores(): void {
  useSidebarStore.setState({
    workflows: [],
    collections: [],
    projects: [],
    environments: [],
    pagination: { skip: 0, limit: 20, total: 0, hasMore: false },
    isRefreshing: false,
    isLoadingMore: false,
    searchQuery: '',
    workflowVersion: 0,
    collectionVersion: 0,
    environmentVersion: 0,
    projectVersion: 0,
    activeWorkspaceId: null,
  });
  useTabStore.setState({ tabs: [], activeTabId: null });
}

function installFetchMock(): ReturnType<typeof vi.fn<typeof fetch>> {
  const workflow = makeWorkflow('wf-created', 'Scoped Smoke');
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = inputUrl(input);
    const method = methodFrom(init);

    if (url.endsWith('/projects')) return responseJson({ projects: [], total: 0 });
    if (url.includes('/environments')) return responseJson([]);
    if (url.includes('/workflows/wf-open') && method === 'GET') return responseJson(makeWorkflow('wf-open', 'Open Me'));
    if (url.includes('/workflows') && method === 'POST') return responseJson(workflow, 201);
    if (url.includes('/workflows') && method === 'GET') return responseJson({ workflows: [workflow], total: 1 });
    if (url.includes('/workflows') && method === 'DELETE') return responseJson({ deleted: true });

    return responseJson({}, 404);
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('sidebar scoped workflow API migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    mocks.useScopeContext.mockReturnValue(scopeContext('ws-1', true));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('fetches workflow lists from the scoped workspace route only', async () => {
    const fetchMock = installFetchMock();
    useSidebarStore.setState({ activeWorkspaceId: 'ws-1' });

    await useSidebarStore.getState().fetchWorkflows(0);

    const urls = fetchMock.mock.calls.map(([input]) => inputUrl(input));
    expect(urls).toContain(`${API_BASE_URL}/api/workspaces/ws-1/workflows?skip=0&limit=20`);
    expect(urls.some((url) => url.startsWith(`${API_BASE_URL}/api/workflows`))).toBe(false);
  });

  it('does not fetch workflows when workspace context is missing', async () => {
    mocks.useScopeContext.mockReturnValue(scopeContext(null, false));
    const fetchMock = installFetchMock();

    await useSidebarStore.getState().fetchWorkflows(0);

    render(<Sidebar />);
    fireEvent.click(screen.getByText('show create workflow'));
    fireEvent.click(screen.getByText('submit workflow prompt'));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith('Workspace context is still loading. Please retry once a workspace is selected.');
    expect(mocks.navigate).not.toHaveBeenCalledWith('/');
  });

  it('creates and opens workflows through scoped workspace routes', async () => {
    const fetchMock = installFetchMock();

    render(<Sidebar />);
    fireEvent.click(screen.getByText('show create workflow'));
    fireEvent.click(screen.getByText('submit workflow prompt'));
    fireEvent.click(screen.getByText('open workflow'));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map(([input, init]) => ({ url: inputUrl(input), method: methodFrom(init) }));
      expect(calls).toContainEqual({ url: `${API_BASE_URL}/api/workspaces/ws-1/workflows?skip=0&limit=20`, method: 'POST' });
      expect(calls).toContainEqual({ url: `${API_BASE_URL}/api/workspaces/ws-1/workflows/wf-open`, method: 'GET' });
    });
  });

  it('deletes workflows through scoped workspace routes', async () => {
    const fetchImpl = vi.fn<typeof authenticatedFetch>(async () => responseJson({ deleted: true }));

    const result = await requestWorkflowDeletion({
      target: { workflowId: 'wf-delete' },
      apiBaseUrl: API_BASE_URL,
      workspaceId: 'ws-1',
      fetchImpl,
    });

    expect(result).toEqual({ deleted: true, workflowId: 'wf-delete' });
    expect(fetchImpl).toHaveBeenCalledWith(`${API_BASE_URL}/api/workspaces/ws-1/workflows/wf-delete`, { method: 'DELETE' });
  });
});
