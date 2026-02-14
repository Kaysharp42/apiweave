const parseDeleteError = async (response, fallbackMessage) => {
  try {
    const errorData = await response.json();
    return errorData?.detail || fallbackMessage;
  } catch (_) {
    return fallbackMessage;
  }
};

export const requestWorkflowDeletion = async ({ target, apiBaseUrl, fetchImpl = fetch }) => {
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

export const requestCollectionDeletion = async ({ target, apiBaseUrl, fetchImpl = fetch }) => {
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
