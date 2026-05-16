import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import API_BASE_URL from '../utils/api';
import { usePalette } from './PaletteContext';
import useSidebarStore from '../stores/SidebarStore';

interface WorkflowVariables {
  [key: string]: unknown;
}

interface WorkflowSettings {
  [key: string]: unknown;
}

interface Collection {
  collectionId: string;
  [key: string]: unknown;
}

interface WorkflowContextValue {
  workflowId: string | undefined;
  variables: WorkflowVariables;
  settings: WorkflowSettings;
  collections: Collection[];
  isLoadingCollections: boolean;
  currentCollectionId: string | null;
  currentCollection: Collection | null;
  setVariables: React.Dispatch<React.SetStateAction<WorkflowVariables>>;
  setSettings: React.Dispatch<React.SetStateAction<WorkflowSettings>>;
  setCurrentCollectionId: React.Dispatch<React.SetStateAction<string | null>>;
  updateVariable: (varName: string, varValue: unknown) => void;
  deleteVariable: (varName: string) => void;
  deleteVariablesWithCleanup: (varNames: string[]) => void;
  updateVariables: (newVariables: WorkflowVariables) => void;
  updateSettings: (newSettings: WorkflowSettings) => void;
  registerExtractors: (extractors: WorkflowVariables) => void;
  fetchCollections: () => Promise<void>;
  refreshCollectionsAndWorkflows: () => void;
  onVariablesDeletedRef: React.MutableRefObject<((varNames: string[]) => void) | null>;
}

const WorkflowContext = createContext<WorkflowContextValue | null>(null);

export const useWorkflow = (): WorkflowContextValue => {
  const context = useContext(WorkflowContext);
  if (!context) {
    throw new Error('useWorkflow must be used within a WorkflowProvider');
  }
  return context;
};

interface WorkflowProviderProps {
  children: ReactNode;
  workflowId: string | undefined;
  initialWorkflow?: unknown;
}

const shallowEqual = (left: Record<string, unknown>, right: Record<string, unknown>): boolean => {
  if (left === right) return true;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
};

export const WorkflowProvider = ({ children, workflowId, initialWorkflow }: WorkflowProviderProps) => {
  const wf = initialWorkflow as { variables?: WorkflowVariables; settings?: WorkflowSettings; collectionId?: string | null; nodeTemplates?: { label?: string; config?: { url?: string; method?: string; headers?: string; body?: string; queryParams?: string; pathVariables?: string; cookies?: string; timeout?: number; openapiMeta?: unknown } }[] } | undefined;
  const [variables, setVariables] = useState<WorkflowVariables>(wf?.variables ?? {});
  const [settings, setSettings] = useState<WorkflowSettings>(wf?.settings ?? {});
  const [collections, setCollections] = useState<Collection[]>([]);
  const [isLoadingCollections, setIsLoadingCollections] = useState(false);
  const [currentCollectionId, setCurrentCollectionId] = useState<string | null>(wf?.collectionId ?? null);

  const { addImportedGroup, removeImportedGroup } = usePalette();

  const extractorVariablesRef = useRef<WorkflowVariables>({});

  const onVariablesDeletedRef = useRef<((varNames: string[]) => void) | null>(null);

  const fetchCollections = useCallback(async () => {
    setIsLoadingCollections(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/collections`);
      if (response.ok) {
        const data = await response.json() as Collection[];
        setCollections(data);
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingCollections(false);
    }
  }, []);

  useEffect(() => {
    setVariables(wf?.variables ?? {});
    setSettings(wf?.settings ?? {});
    setCurrentCollectionId(wf?.collectionId ?? null);
    extractorVariablesRef.current = {};
  }, [workflowId, initialWorkflow]);

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
      label: node.label ?? node.config?.url ?? 'Request',
      url: node.config?.url ?? '',
      method: node.config?.method ?? 'GET',
      headers: node.config?.headers ?? '',
      body: node.config?.body ?? '',
      queryParams: node.config?.queryParams ?? '',
      pathVariables: node.config?.pathVariables ?? '',
      cookies: node.config?.cookies ?? '',
      timeout: node.config?.timeout ?? 30,
      openapiMeta: node.config?.openapiMeta ?? null,
    }));

    addImportedGroup({
      title: 'Workflow Templates',
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

  const updateVariable = useCallback((varName: string, varValue: unknown) => {
    setVariables((prev) => ({
      ...prev,
      [varName]: varValue,
    }));
  }, []);

  const deleteVariable = useCallback((varName: string) => {
    setVariables((prev) => {
      const updated = { ...prev };
      delete updated[varName];
      return updated;
    });
  }, []);

  const deleteVariablesWithCleanup = useCallback((varNames: string[]) => {
    setVariables((prev) => {
      const updated = { ...prev };
      varNames.forEach((name) => delete updated[name]);
      return updated;
    });
    if (onVariablesDeletedRef.current) {
      onVariablesDeletedRef.current(varNames);
    }
  }, []);

  const updateVariables = useCallback((newVariables: WorkflowVariables) => {
    setVariables(newVariables);
  }, []);

  const updateSettings = useCallback((newSettings: WorkflowSettings) => {
    setVariables((prev) => ({
      ...prev,
      ...newSettings,
    }));
  }, []);

  const registerExtractors = useCallback((extractors: WorkflowVariables) => {
    const prevExtractorVarNames = Object.keys(extractorVariablesRef.current);

    if (shallowEqual(extractorVariablesRef.current, extractors)) {
      return;
    }

    extractorVariablesRef.current = extractors;

    setVariables((prev) => {
      const manualVariables: WorkflowVariables = {};
      Object.entries(prev).forEach(([key, value]) => {
        if (!prevExtractorVarNames.includes(key)) {
          manualVariables[key] = value;
        }
      });

      const merged = {
        ...manualVariables,
        ...extractors,
      };

      if (shallowEqual(prev, merged)) {
        return prev;
      }
      return merged;
    });
  }, []);

  const currentCollection = currentCollectionId
    ? collections.find((c) => c.collectionId === currentCollectionId) ?? null
    : null;

  const refreshCollectionsAndWorkflows = useCallback(() => {
    fetchCollections();
    useSidebarStore.getState().signalWorkflowsRefresh();
  }, [fetchCollections]);

  const contextValue: WorkflowContextValue = {
    workflowId,
    variables,
    settings,
    collections,
    isLoadingCollections,
    currentCollectionId,
    currentCollection,
    setVariables,
    setSettings,
    setCurrentCollectionId,
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
