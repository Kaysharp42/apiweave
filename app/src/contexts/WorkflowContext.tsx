import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { usePalette } from "./PaletteContext";
import useSidebarStore from "../stores/SidebarStore";
import { authenticatedFetch } from "../utils/apiweaveClient";
import { projectsUrl } from "../utils/apiweaveClient";
import type { Project } from "../types/Project";
import type { JsonValue } from "@shared/types/JsonValue";

interface WorkflowVariables {
  [key: string]: JsonValue;
}

interface WorkflowSettings {
  [key: string]: unknown;
}

interface WorkflowContextValue {
  workflowId: string | undefined;
  variables: WorkflowVariables;
  settings: WorkflowSettings;
  collections: Project[];
  isLoadingCollections: boolean;
  currentCollectionId: string | null;
  currentCollection: Project | null;
  setVariables: React.Dispatch<React.SetStateAction<WorkflowVariables>>;
  setSettings: React.Dispatch<React.SetStateAction<WorkflowSettings>>;
  setCurrentCollectionId: React.Dispatch<React.SetStateAction<string | null>>;
  updateVariable: (varName: string, varValue: JsonValue) => void;
  deleteVariable: (varName: string) => void;
  deleteVariablesWithCleanup: (varNames: string[]) => void;
  updateVariables: (newVariables: WorkflowVariables) => void;
  updateSettings: (newSettings: WorkflowSettings) => void;
  registerExtractors: (extractors: WorkflowVariables) => void;
  fetchCollections: () => Promise<void>;
  refreshCollectionsAndWorkflows: () => void;
  onVariablesDeletedRef: React.MutableRefObject<
    ((varNames: string[]) => void) | null
  >;
}

const WorkflowContext = createContext<WorkflowContextValue | null>(null);

export const useWorkflow = (): WorkflowContextValue => {
  const context = useContext(WorkflowContext);
  if (!context) {
    throw new Error("useWorkflow must be used within a WorkflowProvider");
  }
  return context;
};

interface WorkflowProviderProps {
  children: ReactNode;
  workflowId: string | undefined;
  initialWorkflow?: unknown;
}

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

export const WorkflowProvider = ({
  children,
  workflowId,
  initialWorkflow,
}: WorkflowProviderProps) => {
  const wf = initialWorkflow as
    | {
        variables?: WorkflowVariables;
        settings?: WorkflowSettings;
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
          };
        }[];
      }
    | undefined;
  const extractorVariablesRef = useRef<WorkflowVariables>({});

  const onVariablesDeletedRef = useRef<((varNames: string[]) => void) | null>(
    null,
  );

  type WorkflowState = {
    variables: WorkflowVariables;
    settings: WorkflowSettings;
    collections: Project[];
    isLoadingCollections: boolean;
    currentCollectionId: string | null;
  };

  type WorkflowAction =
    | { type: "set-variables"; value: WorkflowVariables }
    | { type: "set-settings"; value: WorkflowSettings }
    | { type: "set-collections"; value: Project[] }
    | { type: "set-loading-collections"; value: boolean }
    | { type: "set-current-collection-id"; value: string | null }
    | { type: "update-variable"; varName: string; varValue: JsonValue }
    | { type: "delete-variable"; varName: string }
    | { type: "delete-variables"; varNames: string[] }
    | { type: "update-variables"; value: WorkflowVariables }
    | { type: "update-settings"; value: WorkflowSettings }
    | { type: "register-extractors"; value: WorkflowVariables };

  const [state, dispatch] = useReducer(
    (current: WorkflowState, action: WorkflowAction): WorkflowState => {
      switch (action.type) {
        case "set-variables":
          return { ...current, variables: action.value };
        case "set-settings":
          return { ...current, settings: action.value };
        case "set-collections":
          return { ...current, collections: action.value };
        case "set-loading-collections":
          return { ...current, isLoadingCollections: action.value };
        case "set-current-collection-id":
          return { ...current, currentCollectionId: action.value };
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
        case "update-settings":
          return {
            ...current,
            settings: { ...current.settings, ...action.value },
          };
        case "register-extractors": {
          const prevExtractorVarNames = Object.keys(
            extractorVariablesRef.current,
          );
          if (shallowEqual(extractorVariablesRef.current, action.value)) {
            return current;
          }

          extractorVariablesRef.current = action.value;

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

          if (shallowEqual(current.variables, merged)) {
            return current;
          }

          return { ...current, variables: merged };
        }
        default:
          return current;
      }
    },
    {
      variables: wf?.variables ?? {},
      settings: wf?.settings ?? {},
      collections: [],
      isLoadingCollections: false,
      currentCollectionId: wf?.collectionId ?? null,
    },
  );

  const { addImportedGroup, removeImportedGroup } = usePalette();

  const fetchCollections = useCallback(async () => {
    dispatch({ type: "set-loading-collections", value: true });
    const workspaceId = useSidebarStore.getState().activeWorkspaceId;
    if (!workspaceId) {
      dispatch({ type: "set-loading-collections", value: false });
      return;
    }
    try {
      const response = await authenticatedFetch(projectsUrl(workspaceId));
      if (response.ok) {
        const data = (await response.json()) as {
          projects: Project[];
          total: number;
        };
        dispatch({ type: "set-collections", value: data.projects });
      }
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

  const updateSettings = useCallback((newSettings: WorkflowSettings) => {
    dispatch({ type: "update-settings", value: newSettings });
  }, []);

  const registerExtractors = useCallback((extractors: WorkflowVariables) => {
    dispatch({ type: "register-extractors", value: extractors });
  }, []);

  const currentCollection = state.currentCollectionId
    ? (state.collections.find(
        (c) => c.collectionId === state.currentCollectionId,
      ) ?? null)
    : null;

  const refreshCollectionsAndWorkflows = useCallback(() => {
    fetchCollections();
    useSidebarStore.getState().signalWorkflowsRefresh();
  }, [fetchCollections]);

  const resolveSetStateAction = <T,>(
    currentValue: T,
    nextValue: React.SetStateAction<T>,
  ): T =>
    typeof nextValue === "function"
      ? (nextValue as (previousValue: T) => T)(currentValue)
      : nextValue;

  const contextValue: WorkflowContextValue = {
    workflowId,
    variables: state.variables,
    settings: state.settings,
    collections: state.collections,
    isLoadingCollections: state.isLoadingCollections,
    currentCollectionId: state.currentCollectionId,
    currentCollection,
    setVariables: (value) =>
      dispatch({
        type: "set-variables",
        value: resolveSetStateAction(state.variables, value),
      }),
    setSettings: (value) =>
      dispatch({
        type: "set-settings",
        value: resolveSetStateAction(state.settings, value),
      }),
    setCurrentCollectionId: (value) =>
      dispatch({
        type: "set-current-collection-id",
        value: resolveSetStateAction(state.currentCollectionId, value),
      }),
    updateVariable,
    deleteVariable,
    deleteVariablesWithCleanup,
    updateVariables,
    updateSettings,
    registerExtractors,
    fetchCollections,
    refreshCollectionsAndWorkflows,
    onVariablesDeletedRef,
  };

  return (
    <WorkflowContext.Provider value={contextValue}>
      {children}
    </WorkflowContext.Provider>
  );
};

export default WorkflowContext;
