import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import WorkflowContext from "../contexts/WorkflowContext";
import WorkspaceContext from "../contexts/WorkspaceContext";
import useEnvironmentStore, { getSelectedEnvironment } from "../stores/EnvironmentStore";
import type { SecretNamesInScope } from "../types/SecretNamesInScope";
import { fetchSecretNames, forgetSecretNames } from "../utils/secretNames";

/**
 * The secret names the current workflow's run can resolve: the workspace's,
 * and the selected environment's. Read through `useContext`, so a component
 * outside a workflow gets an empty list rather than an error.
 */
export function useSecretNamesInScope(): SecretNamesInScope {
  const workflowId = useContext(WorkflowContext)?.workflowId;
  const workspaceId = useContext(WorkspaceContext)?.currentWorkspace?.workspaceId ?? null;
  const selectedEnvMap = useEnvironmentStore((state) => state.selectedEnvironmentByWorkflow);
  const [names, setNames] = useState<readonly string[] | null>(null);
  const [version, setVersion] = useState(0);

  const environmentId = useMemo(
    () => (workflowId ? getSelectedEnvironment(workflowId) : null),
    // The resolver reads the store imperatively; this is what re-runs it.
    [workflowId, selectedEnvMap],
  );

  useEffect(() => {
    if (!workspaceId) return undefined;
    let active = true;
    void fetchSecretNames(workspaceId, environmentId).then((fetched) => {
      if (active) setNames(fetched);
    });
    return () => {
      active = false;
    };
  }, [workspaceId, environmentId, version]);

  const refresh = useCallback(() => {
    if (workspaceId) forgetSecretNames(workspaceId);
    setVersion((current) => current + 1);
  }, [workspaceId]);

  return { names, workspaceId, environmentId, refresh };
}
