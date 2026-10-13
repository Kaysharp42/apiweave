import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { usePalette } from "./PaletteContext";
import useSidebarStore from "../stores/SidebarStore";
import { apiweave } from "../utils/apiweaveClient";
import type { JsonValue } from "@shared/types/JsonValue";
import type {
  WorkflowAction,
  WorkflowContextValue,
  WorkflowProviderProps,
  WorkflowState,
  WorkflowVariables,
} from "../types";

const WorkflowContext = createContext<WorkflowContextValue | null>(null);

export const useWorkflow = (): WorkflowContextValue => {
  const context = useContext(WorkflowContext);
  if (!context) {
    throw new Error("useWorkflow must be used within a WorkflowProvider");
  }
  return context;
};

const shallowEqual = (
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean => {
  if (left === right) return true;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
};

const resolveSetStateAction = <T,>(
  currentValue: T,
  nextValue: React.SetStateAction<T>,
): T =>
  typeof nextValue === "function"
    ? (nextValue as (previousValue: T) => T)(currentValue)
    : nextValue;

function workflowReducer(
  current: WorkflowState,
  action: WorkflowAction,
): WorkflowState {
  switch (action.type) {
    case "set-variables":
      return {
        ...current,
        variables: resolveSetStateAction(current.variables, action.value),
      };
    case "set-collections":
      return { ...current, collections: action.value };
    case "set-loading-collections":
      return { ...current, isLoadingCollections: action.value };
    case "set-current-collection-id":
      return {
        ...current,
        currentCollectionId: resolveSetStateAction(
          current.currentCollectionId,
          action.value,
        ),
      };
    case "update-variable":
      return {
        ...current,
        variables: {
          ...current.variables,
          [action.varName]: action.varValue,
        },
      };
    case "delete-variable": {
      const updated = { ...current.variables };
      delete updated[action.varName];
      return { ...current, variables: updated };
    }
    case "delete-variables": {
      const updated = { ...current.variables };
      action.varNames.forEach((name) => delete updated[name]);
      return { ...current, variables: updated };
    }
    case "update-variables":
      return { ...current, variables: action.value };
    case "register-extractors": {
      if (shallowEqual(current.extractorVariables, action.value)) {
        return current;
      }

      const prevExtractorVarNames = Object.keys(current.extractorVariables);
      const manualVariables: WorkflowVariables = {};
      Object.entries(current.variables).forEach(([key, value]) => {
        if (!prevExtractorVarNames.includes(key)) {
          manualVariables[key] = value;
        }
      });

      const merged = {
        ...manualVariables,
        ...action.value,
      };

      return {
        ...current,
        extractorVariables: action.value,
        variables: shallowEqual(current.variables, merged)
          ? current.variables
          : merged,
      };
    }
    default:
      return current;
  }
}

export const WorkflowProvider = ({
  children,
  workflowId,
  initialWorkflow,
}: WorkflowProviderProps) => {
  const wf = initialWorkflow as
    | {
        variables?: WorkflowVariables;
        collectionId?: string | null;
        nodeTemplates?: {
          label?: string;
          config?: {
            url?: string;
            method?: string;
            headers?: string;
            body?: string;
            queryParams?: string;
            pathVariables?: string;
            cookies?: string;
            timeout?: number;
            openapiMeta?: unknown;
            responseSchemas?: Record<string, JsonValue>;
          };
        }[];
      }
    | undefined;

  const onVariablesDeletedRef = useRef<((varNames: string[]) => void) | null>(
    null,
  );

  const [state, dispatch] = useReducer(workflowReducer, {
    variables: wf?.variables ?? {},
    extractorVariables: {},
    collections: [],
    isLoadingCollections: false,
    currentCollectionId: wf?.collectionId ?? null,
  });

  const { addImportedGroup, removeImportedGroup } = usePalette();

  const fetchCollections = useCallback(async () => {
    dispatch({ type: "set-loading-collections", value: true });
    const workspaceId = useSidebarStore.getState().activeWorkspaceId;
    if (!workspaceId) {
      dispatch({ type: "set-loading-collections", value: false });
      return;
    }
    try {
      const data = await apiweave.projects.list(workspaceId);
      dispatch({ type: "set-collections", value: [...data.items] });
    } catch {
      // ignore
    } finally {
      dispatch({ type: "set-loading-collections", value: false });
    }
  }, []);

  useEffect(() => {
    const templateGroupId = `workflow-templates-${workflowId}`;
    const openApiGroupId = `openapi-${workflowId}`;
    const harGroupId = `har-${workflowId}`;
    const curlGroupId = `curl-${workflowId}`;

    return () => {
      removeImportedGroup(templateGroupId);
      removeImportedGroup(openApiGroupId);
      removeImportedGroup(harGroupId);
      removeImportedGroup(curlGroupId);
    };
  }, [workflowId, removeImportedGroup]);

  useEffect(() => {
    if (!wf?.nodeTemplates || wf.nodeTemplates.length === 0) {
      return;
    }

    const templateItems = wf.nodeTemplates.map((node) => ({
      label: node.label ?? node.config?.url ?? "Request",
      url: node.config?.url ?? "",
      method: node.config?.method ?? "GET",
      headers: node.config?.headers ?? "",
      body: node.config?.body ?? "",
      queryParams: node.config?.queryParams ?? "",
      pathVariables: node.config?.pathVariables ?? "",
      cookies: node.config?.cookies ?? "",
      timeout: node.config?.timeout ?? 30,
      openapiMeta: node.config?.openapiMeta ?? null,
      ...(node.config?.responseSchemas
        ? { responseSchemas: node.config.responseSchemas }
        : {}),
    }));

    addImportedGroup({
      title: "Workflow Templates",
      id: `workflow-templates-${workflowId}`,
      items: templateItems,
    });
  }, [workflowId, wf, addImportedGroup]);

  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

  const collectionVersion = useSidebarStore((s) => s.collectionVersion);
  useEffect(() => {
    if (collectionVersion > 0) {
      fetchCollections();
    }
  }, [collectionVersion, fetchCollections]);

  const updateVariable = useCallback((varName: string, varValue: JsonValue) => {
    dispatch({ type: "update-variable", varName, varValue });
  }, []);

  const deleteVariable = useCallback((varName: string) => {
    dispatch({ type: "delete-variable", varName });
  }, []);

  const deleteVariablesWithCleanup = useCallback((varNames: string[]) => {
    dispatch({ type: "delete-variables", varNames });
    if (onVariablesDeletedRef.current) {
      onVariablesDeletedRef.current(varNames);
    }
  }, []);

  const updateVariables = useCallback((newVariables: WorkflowVariables) => {
    dispatch({ type: "update-variables", value: newVariables });
  }, []);

  const registerExtractors = useCallback((extractors: WorkflowVariables) => {
    dispatch({ type: "register-extractors", value: extractors });
  }, []);

  const currentCollection = useMemo(
    () =>
      state.currentCollectionId
        ? (state.collections.find(
            (c) => c.collectionId === state.currentCollectionId,
          ) ?? null)
        : null,
    [state.collections, state.currentCollectionId],
  );

  const refreshCollectionsAndWorkflows = useCallback(() => {
    fetchCollections();
    useSidebarStore.getState().signalWorkflowsRefresh();
  }, [fetchCollections]);

  const setVariables = useCallback(
    (value: React.SetStateAction<WorkflowVariables>) =>
      dispatch({ type: "set-variables", value }),
    [],
  );

  const setCurrentCollectionId = useCallback(
    (value: React.SetStateAction<string | null>) =>
      dispatch({ type: "set-current-collection-id", value }),
    [],
  );

  // Memoized so a provider re-render that changes nothing here does not
  // re-render every consumer — the canvas and each HTTP node among them.
  const contextValue = useMemo<WorkflowContextValue>(
    () => ({
      workflowId,
      variables: state.variables,
      collections: state.collections,
      isLoadingCollections: state.isLoadingCollections,
      currentCollectionId: state.currentCollectionId,
      currentCollection,
      setVariables,
      setCurrentCollectionId,
      updateVariable,
      deleteVariable,
      deleteVariablesWithCleanup,
      updateVariables,
      registerExtractors,
      fetchCollections,
      refreshCollectionsAndWorkflows,
      onVariablesDeletedRef,
    }),
    [
      workflowId,
      state.variables,
      state.collections,
      state.isLoadingCollections,
      state.currentCollectionId,
      currentCollection,
      setVariables,
      setCurrentCollectionId,
      updateVariable,
      deleteVariable,
      deleteVariablesWithCleanup,
      updateVariables,
      registerExtractors,
      fetchCollections,
      refreshCollectionsAndWorkflows,
    ],
  );

  return (
    <WorkflowContext.Provider value={contextValue}>
      {children}
    </WorkflowContext.Provider>
  );
};

export default WorkflowContext;
