interface DeletionTarget {
  workflowId?: string;
  collectionId?: string;
}

interface DeletionRequestParams {
  target: DeletionTarget | null | undefined;
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
}

interface DeletionResult {
  deleted: boolean;
  workflowId?: string;
  collectionId?: string;
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

export const requestWorkflowDeletion = async ({ target, apiBaseUrl, fetchImpl = fetch }: DeletionRequestParams): Promise<DeletionResult> => {
  const workflowId = target?.workflowId;
  if (!workflowId) {
    return { deleted: false, reason: 'missing-target' };
  }

  const response = await fetchImpl(`${apiBaseUrl}/api/workflows/${workflowId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(await parseDeleteError(response, 'Failed to delete workflow'));
  }

  return { deleted: true, workflowId };
};

export const requestCollectionDeletion = async ({ target, apiBaseUrl, fetchImpl = fetch }: DeletionRequestParams): Promise<DeletionResult> => {
  const collectionId = target?.collectionId;
  if (!collectionId) {
    return { deleted: false, reason: 'missing-target' };
  }

  const response = await fetchImpl(`${apiBaseUrl}/api/collections/${collectionId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(await parseDeleteError(response, 'Failed to delete collection'));
  }

  return { deleted: true, collectionId };
};
