import { authenticatedFetch } from './authenticatedApi';
import { projectsUrl, workflowUrl } from './scopedApi';

interface DeletionTarget {
  workflowId?: string;
  projectId?: string;
}

interface DeletionRequestParams {
  target: DeletionTarget | null | undefined;
  apiBaseUrl: string;
  workspaceId?: string;
  fetchImpl?: typeof authenticatedFetch;
}

interface DeletionResult {
  deleted: boolean;
  workflowId?: string;
  projectId?: string;
  reason?: string;
}

const parseDeleteError = async (response: Response, fallbackMessage: string): Promise<string> => {
  try {
    const errorData = await response.json() as { detail?: string };
    return errorData?.detail ?? fallbackMessage;
  } catch {
    return fallbackMessage;
  }
};

export const requestWorkflowDeletion = async ({ target, workspaceId, fetchImpl = authenticatedFetch }: DeletionRequestParams): Promise<DeletionResult> => {
  const workflowId = target?.workflowId;
  if (!workflowId) {
    return { deleted: false, reason: 'missing-target' };
  }
  if (!workspaceId) {
    return { deleted: false, reason: 'missing-workspace' };
  }

  const response = await fetchImpl(workflowUrl(workspaceId, workflowId), {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(await parseDeleteError(response, 'Failed to delete workflow'));
  }

  return { deleted: true, workflowId };
};

export const requestProjectDeletion = async ({ target, workspaceId, fetchImpl = authenticatedFetch }: DeletionRequestParams): Promise<DeletionResult> => {
  const projectId = target?.projectId;
  if (!projectId) {
    return { deleted: false, reason: 'missing-target' };
  }
  if (!workspaceId) {
    return { deleted: false, reason: 'missing-workspace' };
  }

  const response = await fetchImpl(projectsUrl(workspaceId, projectId), {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(await parseDeleteError(response, 'Failed to delete project'));
  }

  return { deleted: true, projectId };
};
