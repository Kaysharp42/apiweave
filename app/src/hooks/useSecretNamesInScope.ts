import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import WorkflowContext from "../contexts/WorkflowContext";
import WorkspaceContext from "../contexts/WorkspaceContext";
import useEnvironmentStore, { getSelectedEnvironment } from "../stores/EnvironmentStore";
import type { SecretNamesInScope } from "../types/SecretNamesInScope";
import {
  fetchSecretNames,
  forgetSecretNames,
  getSecretNamesRevision,
  subscribeSecretNames,
} from "../utils/secretNames";

/**
 * The secret names the current workflow's run can resolve: the workspace's,
 * and the selected environment's. Read through `useContext`, so a component
 * outside a workflow gets an empty list rather than an error.
 *
 * Every instance keeps its own copy, so all of them watch the revision of the
 * shared list cache: when a secret is saved here, the component that saved it
 * clears the cache and every other instance — the badge on a canvas node, the
 * suggestions in a field — reads the new list instead of holding the old one.
 */
export function useSecretNamesInScope(): SecretNamesInScope {
  const workflowId = useContext(WorkflowContext)?.workflowId;
  const workspaceId = useContext(WorkspaceContext)?.currentWorkspace?.workspaceId ?? null;
  const selectedEnvMap = useEnvironmentStore((state) => state.selectedEnvironmentByWorkflow);
  const [names, setNames] = useState<readonly string[] | null>(null);
  const revision = useSyncExternalStore(subscribeSecretNames, getSecretNamesRevision);

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
  }, [workspaceId, environmentId, revision]);

  // Clearing is the whole of it: the drop notifies every reader, this one
  // included, so each fetches the list again rather than this instance alone.
  const refresh = useCallback(() => {
    if (workspaceId) forgetSecretNames(workspaceId);
  }, [workspaceId]);

  return { names, workspaceId, environmentId, refresh };
}
