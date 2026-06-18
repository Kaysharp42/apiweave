import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import API_BASE_URL from '../utils/api';
import { CollectionManager } from '../components/CollectionManager';
import { CollectionExportImport } from '../components/CollectionExportImport';
import type { ScopeContext } from '../types';

type AuthenticatedFetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const mockScope = vi.hoisted((): ScopeContext => ({
  workspaceId: 'ws-1',
  workspaceSlug: 'personal',
  orgId: null,
  orgSlug: null,
  userId: 'user-1',
  isReady: true,
}));

const authenticatedFetchMock = vi.hoisted(() => vi.fn<AuthenticatedFetchMock>());

vi.mock('../hooks/useScopeContext', () => ({
  useScopeContext: () => mockScope,
}));

vi.mock('../utils/authenticatedApi', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('project migration UI', () => {
  beforeEach(() => {
    authenticatedFetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a project through the workspace-scoped route', async () => {
    const user = userEvent.setup();
    authenticatedFetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ projectId: 'proj-1', collectionId: 'proj-1' }), { status: 201 });
      }
      if (url.includes('/projects')) {
        return new Response(JSON.stringify({ projects: [], total: 0 }), { status: 200 });
      }
      return new Response(JSON.stringify({ workflows: [], total: 0 }), { status: 200 });
    });

    render(<CollectionManager open={true} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /new project/i }));
    await user.type(screen.getByLabelText(/project name/i), 'Smoke Project');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(authenticatedFetchMock).toHaveBeenCalledWith(
        `${API_BASE_URL}/api/workspaces/ws-1/projects`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Smoke Project', description: '', color: 'var(--aw-status-info)' }),
        }),
      );
    });
  });

  it('exports a project from scoped route and preserves awecollection extension', async () => {
    const user = userEvent.setup();
    const createdUrls: string[] = [];
    const appendedDownloads: string[] = [];
    const originalAppendChild = document.body.appendChild.bind(document.body);

    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => {
        createdUrls.push(blob.type);
        return 'blob:project-export';
      },
      revokeObjectURL: vi.fn(),
    });

    vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
      if (node instanceof HTMLAnchorElement) {
        appendedDownloads.push(node.download);
      }
      return originalAppendChild(node);
    });

    authenticatedFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ schemaVersion: 2, project: { name: 'Smoke Project' } }), { status: 200 }),
    );

    render(
      <CollectionExportImport
        isOpen={true}
        onClose={vi.fn()}
        mode="export"
        projectId="proj-1"
        projectName="Smoke Project"
      />,
    );

    await user.click(screen.getByRole('button', { name: /download project bundle/i }));

    await waitFor(() => {
      expect(authenticatedFetchMock).toHaveBeenCalledWith(
        `${API_BASE_URL}/api/workspaces/ws-1/projects/proj-1/export?include_environment=true`,
      );
      expect(appendedDownloads).toContain('Smoke_Project.awecollection');
      expect(createdUrls).toContain('application/json');
    });
  });
});
