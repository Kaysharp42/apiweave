import { useState, useCallback, useRef, useEffect, useContext, useMemo, type MutableRefObject } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  Panel,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
  type ReactFlowInstance,
} from 'reactflow';
// @ts-expect-error reactflow CSS import has no type declarations
import 'reactflow/dist/style.css';

import HTTPRequestNode from './nodes/HTTPRequestNode';
import AssertionNode from './nodes/AssertionNode';
import DelayNode from './nodes/DelayNode';
import StartNode from './nodes/StartNode';
import EndNode from './nodes/EndNode';
import MergeNode from './nodes/MergeNode';
import CustomEdge from './CustomEdge';
import AddNodesPanel from './AddNodesPanel';
import NodeModal from './NodeModal';
import HistoryModal from './HistoryModal';
import ImportToNodesPanel from './ImportToNodesPanel';
import WorkflowJsonEditor from './WorkflowJsonEditor';
import SecretsPrompt from './SecretsPrompt';
import { AppContext } from '../App';
import { useWorkflow } from '../contexts/WorkflowContext';
import { usePalette } from '../contexts/PaletteContext';
import { toast } from 'sonner';
import { CanvasToolbar } from './organisms';
import useTabStore from '../stores/TabStore';
import useCanvasStore from '../stores/CanvasStore';
import useSidebarStore from '../stores/SidebarStore';
import useAutoSave from '../hooks/useAutoSave';
import useCanvasDrop from '../hooks/useCanvasDrop';
import useWorkflowPolling from '../hooks/useWorkflowPolling';
import API_BASE_URL from '../utils/api';
import { shouldBlockDestructiveAutosave } from '../utils/workflowSaveSafety';
import { buildSwaggerRefreshSummary } from '../utils/swaggerRefreshSummary';
import { getCanvasClipboardShortcutAction } from '../utils/shortcutGuards';
import type { Environment } from '../types';

interface NodeData {
  label?: string;
  config?: Record<string, unknown>;
  executionStatus?: string;
  executionResult?: unknown;
  executionTimestamp?: number;
  parentNodeId?: string;
  branchCount?: number;
  incomingBranchCount?: number;
  incomingBranches?: Array<{
    index: number;
    nodeId: string;
    label: string;
    edgeLabel: string;
  }>;
  invalid?: boolean;
  schemaRefreshWarning?: {
    text: string;
    sourceUrl: string;
    refreshedAt: string;
    endpointFingerprint: string | null;
  };
  extractors?: Record<string, unknown>;
  [key: string]: unknown;
}

interface EdgeData {
  label?: string | null;
  [key: string]: unknown;
}

interface WorkflowCanvasNode {
  nodeId?: string;
  id?: string;
  type?: string;
  position: { x: number; y: number };
  label?: string;
  config?: Record<string, unknown>;
  data?: {
    label?: string;
    config?: Record<string, unknown>;
  };
}

interface WorkflowCanvasEdge {
  edgeId?: string;
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string | null;
}

export interface WorkflowCanvasWorkflow {
  environmentId?: string;
  nodes?: WorkflowCanvasNode[];
  edges?: WorkflowCanvasEdge[];
}

interface WorkflowCanvasProps {
  workflowId: string | undefined;
  workflow: WorkflowCanvasWorkflow | null | undefined;
  isPanelOpen?: boolean;
  showVariablesPanel?: boolean;
  onShowVariablesPanel?: (show: boolean) => void;
}

const nodeTypes: NodeTypes = {
  'http-request': HTTPRequestNode as NodeTypes[string],
  'assertion': AssertionNode as NodeTypes[string],
  'delay': DelayNode as NodeTypes[string],
  'start': StartNode as NodeTypes[string],
  'end': EndNode as NodeTypes[string],
  'merge': MergeNode as NodeTypes[string],
};

const edgeTypes: EdgeTypes = {
  'custom': CustomEdge as EdgeTypes[string],
};

const initialNodes: Node<NodeData>[] = [
  {
    id: 'start-1',
    type: 'start',
    position: { x: 250, y: 50 },
    data: { label: 'Start' },
  },
];

interface EnvironmentWithSwagger extends Environment {
  swaggerDocUrl?: string;
}

interface ImportedItem {
  label: string;
  url: string;
  method: string;
  headers: string;
  body: string;
  queryParams: string;
  pathVariables: string;
  cookies: string;
  timeout: number;
  openapiMeta: unknown;
}

interface SwaggerRefreshResult {
  skipped?: boolean;
  reason?: string;
  endpointCount?: number;
  error?: string;
}

interface WorkflowJsonData {
  nodes: Array<{
    nodeId: string;
    type: string;
    label?: string;
    position: { x: number; y: number };
    config?: Record<string, unknown>;
  }>;
  edges: Array<{
    edgeId: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
    label?: string | null;
  }>;
  variables: Record<string, unknown>;
}

interface HydratedBaseline {
  nodeCount: number;
  edgeCount: number;
}

const assertionEdgeColor = (sourceHandle: string | null | undefined): string =>
  sourceHandle === 'pass' ? 'var(--aw-status-success)' : 'var(--aw-status-error)';

const branchEdgeColor = 'var(--aw-branch-edge)';
const branchLabelColor = 'var(--aw-branch-label)';
const edgeLabelBackground = 'var(--aw-surface-raised)';

export function WorkflowCanvas({
  workflowId,
  workflow,
  showVariablesPanel = false,
  onShowVariablesPanel = () => {},
}: WorkflowCanvasProps) {
  const context = useContext(AppContext);
  const { darkMode, autoSaveEnabled } = context || { darkMode: false, autoSaveEnabled: true };

  const darkModeRef = useRef(darkMode);
  useEffect(() => {
    darkModeRef.current = darkMode;
  }, [darkMode]);

  const {
    variables: workflowVariables,
    registerExtractors,
    updateVariable,
    onVariablesDeletedRef,
  } = useWorkflow();
  const { addImportedGroup, removeImportedGroup } = usePalette();

  const [nodes, setNodes, onNodesChange] = useNodesState<NodeData>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<EdgeData>([]);

  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const edgesRef = useRef(edges);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  const onNodesChangeRef = useRef(onNodesChange);
  useEffect(() => {
    onNodesChangeRef.current = onNodesChange;
  }, [onNodesChange]);

  const onEdgesChangeRef = useRef(onEdgesChange);
  useEffect(() => {
    onEdgesChangeRef.current = onEdgesChange;
  }, [onEdgesChange]);

  const workflowVariablesRef = useRef(workflowVariables);
  useEffect(() => {
    workflowVariablesRef.current = workflowVariables;
  }, [workflowVariables]);

  const [selectedNode, setSelectedNode] = useState<Node<NodeData> | null>(null);
  const [isDraggingNode, setIsDraggingNode] = useState(false);
  const [isWorkflowHydrated, setIsWorkflowHydrated] = useState(false);
  const reactFlowInstanceRef = useRef<ReactFlowInstance<NodeData, EdgeData> | null>(null) as MutableRefObject<ReactFlowInstance<NodeData, EdgeData> | null>;
  const [modalNode, setModalNode] = useState<Node<NodeData> | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showImportToNodes, setShowImportToNodes] = useState(false);
  const [showJsonEditor, setShowJsonEditor] = useState(false);
  const [environments, setEnvironments] = useState<EnvironmentWithSwagger[]>([]);
  const [isSwaggerRefreshing, setIsSwaggerRefreshing] = useState(false);
  const swaggerRefreshSignatureRef = useRef('');
  const swaggerRefreshRequestIdRef = useRef(0);
  const hydratedBaselineRef = useRef<HydratedBaseline | null>(null);
  const envSwaggerGroupId = `env-openapi-${workflowId}`;

  const [selectedEnvironment, setSelectedEnvironment] = useState<string | null>(() => {
    const workflowSpecific = localStorage.getItem(`selectedEnvironment_${workflowId}`);
    if (workflowSpecific) {
      return workflowSpecific;
    }

    if (workflow?.environmentId) {
      return workflow.environmentId;
    }

    const globalDefault = localStorage.getItem('defaultEnvironment');
    if (globalDefault) {
      return globalDefault;
    }

    return null;
  });

  useEffect(() => {
    if (selectedEnvironment) {
      localStorage.setItem(`selectedEnvironment_${workflowId}`, selectedEnvironment);
      localStorage.setItem('defaultEnvironment', selectedEnvironment);
    } else {
      localStorage.removeItem(`selectedEnvironment_${workflowId}`);
    }
  }, [selectedEnvironment, workflowId]);

  const {
    isRunning,
    runWorkflow,
    runFromLastFailed,
    runAllFailed,
    runFromFailedNodes,
    resumeOptions,
    resumeSourceRunId,
    isResumeLoading,
    showSecretsPrompt,
    setShowSecretsPrompt,
    pendingRunRef,
    handleSecretsProvided,
    loadHistoricalRun,
  } = useWorkflowPolling({
    workflowId,
    nodes,
    setNodes,
    selectedEnvironment,
    environments,
    reactFlowInstanceRef,
  });

  const newDuplicateNodeRef = useRef<string | null>(null);

  useEffect(() => {
    const extractorsFromNodes: Record<string, unknown> = {};
    nodes.forEach(node => {
      if (node.type === 'http-request' && node.data?.config?.extractors) {
        Object.assign(extractorsFromNodes, node.data.config.extractors);
      }
    });
    registerExtractors(extractorsFromNodes);
  }, [nodes, registerExtractors]);

  useEffect(() => {
    onVariablesDeletedRef.current = (deletedVars: string[]) => {
      if (!deletedVars || deletedVars.length === 0) return;
      setNodes(currentNodes => currentNodes.map(node => {
        if (node.type === 'http-request' && node.data?.config?.extractors) {
          const updatedExtractors = { ...node.data.config.extractors } as Record<string, unknown>;
          let modified = false;
          deletedVars.forEach(varName => {
            if (varName in updatedExtractors) {
              delete updatedExtractors[varName];
              modified = true;
            }
          });
          if (modified) {
            return {
              ...node,
              data: {
                ...node.data,
                config: { ...node.data.config, extractors: updatedExtractors }
              }
            };
          }
        }
        return node;
      }));
    };
    return () => { onVariablesDeletedRef.current = null; };
  }, [setNodes, onVariablesDeletedRef]);

  const fetchEnvironments = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/environments`);
      if (response.ok) {
        const data = await response.json() as Environment[];
        setEnvironments(data);
      }
    } catch (error) {
      console.error('Error fetching environments:', error);
    }
  }, []);

  useEffect(() => { fetchEnvironments(); }, [fetchEnvironments]);

  const environmentVersion = useSidebarStore((s) => s.environmentVersion);
  useEffect(() => {
    if (environmentVersion > 0) fetchEnvironments();
  }, [environmentVersion, fetchEnvironments]);

  const clearSwaggerWarningOnCanvas = useCallback(() => {
    setNodes((currentNodes) => {
      let didChange = false;
      const nextNodes = currentNodes.map((node) => {
        if (node.type !== 'http-request' || !node.data?.schemaRefreshWarning) {
          return node;
        }
        const restData = { ...node.data };
        delete restData.schemaRefreshWarning;
        didChange = true;
        return {
          ...node,
          data: restData,
        };
      });
      return didChange ? nextNodes : currentNodes;
    });
  }, [setNodes]);

  const refreshSwaggerTemplates = useCallback(async ({ force = false, showSuccessToast = false } = {}): Promise<SwaggerRefreshResult> => {
    const selectedEnvId = selectedEnvironment && selectedEnvironment.trim()
      ? selectedEnvironment.trim()
      : null;
    const selectedEnvObject = selectedEnvId
      ? environments.find((env) => env.environmentId === selectedEnvId)
      : null;
    const swaggerDocUrl = selectedEnvObject?.swaggerDocUrl?.trim() || '';

    const signature = `${workflowId}::${selectedEnvId || ''}::${swaggerDocUrl}`;
    if (!force && swaggerRefreshSignatureRef.current === signature) {
      return { skipped: true, reason: 'unchanged-signature' };
    }
    swaggerRefreshSignatureRef.current = signature;

    if (!selectedEnvId) {
      removeImportedGroup(envSwaggerGroupId);
      clearSwaggerWarningOnCanvas();
      if (showSuccessToast) {
        toast.error('Select an environment before refreshing Swagger.');
      }
      return { skipped: true, reason: 'missing-environment' };
    }

    if (!swaggerDocUrl) {
      removeImportedGroup(envSwaggerGroupId);
      clearSwaggerWarningOnCanvas();
      if (showSuccessToast) {
        toast.error(`Environment "${selectedEnvObject?.name || 'Selected'}" has no Swagger/OpenAPI URL.`);
      }
      return { skipped: true, reason: 'missing-swagger-url' };
    }

    const requestId = swaggerRefreshRequestIdRef.current + 1;
    swaggerRefreshRequestIdRef.current = requestId;
    setIsSwaggerRefreshing(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/workflows/import/openapi/url?swagger_url=${encodeURIComponent(swaggerDocUrl)}&sanitize=true`
      );

      if (!response.ok) {
        let detail = 'Failed to load Swagger/OpenAPI URL';
        try {
          const errorBody = await response.json() as { detail?: string };
          detail = errorBody.detail || detail;
        } catch {
          // Keep default error detail if response body is not JSON
        }
        throw new Error(detail);
      }

      const result = await response.json() as { nodes?: Array<{ label?: string; config?: Record<string, unknown> }>; stats?: Record<string, unknown> };
      if (requestId !== swaggerRefreshRequestIdRef.current) {
        return { skipped: true, reason: 'superseded' };
      }

      const apiNodes = result.nodes || [];
      const items: ImportedItem[] = apiNodes.map((node) => {
        const config = node.config || {};
        return {
          label: node.label || (config.url as string) || 'Request',
          url: (config.url as string) || '',
          method: (config.method as string) || 'GET',
          headers: (config.headers as string) || '',
          body: (config.body as string) || '',
          queryParams: (config.queryParams as string) || '',
          pathVariables: (config.pathVariables as string) || '',
          cookies: (config.cookies as string) || '',
          timeout: (config.timeout as number) || 30,
          openapiMeta: (config.openapiMeta as unknown) || null,
        };
      });

      addImportedGroup({
        title: `Swagger: ${selectedEnvObject?.name || 'Environment'}`,
        id: envSwaggerGroupId,
        items,
      });

      const latestFingerprintSet = new Set<string>();
      const latestMethodPathSet = new Set<string>();
      const latestMethodsByPath = new Map<string, Set<string>>();
      const latestByOperationId = new Map<string, Record<string, unknown>>();

      apiNodes.forEach((apiNode) => {
        const meta = (apiNode.config as Record<string, unknown> | undefined)?.openapiMeta as Record<string, unknown> | undefined;
        if (!meta || meta.source !== 'openapi') return;

        const definitionScope = ((meta.definitionScope as string) || '').trim();
        const method = ((meta.method as string) || '').toUpperCase();
        const path = (meta.path as string) || '';
        const fingerprint = (meta.fingerprint as string) || '';
        const operationId = ((meta.operationId as string) || '').trim();

        if (fingerprint) latestFingerprintSet.add(fingerprint);
        if (method && path) latestMethodPathSet.add(`${definitionScope}|${method}|${path}`);

        if (path && method) {
          const pathScopeKey = `${definitionScope}|${path}`;
          if (!latestMethodsByPath.has(pathScopeKey)) {
            latestMethodsByPath.set(pathScopeKey, new Set());
          }
          latestMethodsByPath.get(pathScopeKey)!.add(method);
        }

        if (operationId) {
          latestByOperationId.set(`${definitionScope}|${operationId}`, meta);
        }
      });

      setNodes((currentNodes) => {
        let didChange = false;
        const nextNodes = currentNodes.map((node) => {
          if (node.type !== 'http-request') {
            return node;
          }

          const existingWarning = node.data?.schemaRefreshWarning;
          const nodeMeta = node.data?.config?.openapiMeta as Record<string, unknown> | undefined;

          if (!nodeMeta || nodeMeta.source !== 'openapi') {
            if (!existingWarning) {
              return node;
            }
            didChange = true;
            const restData = { ...node.data! };
            delete restData.schemaRefreshWarning;
            return { ...node, data: restData };
          }

          const metaMethod = ((nodeMeta.method as string) || '').toUpperCase();
          const metaPath = (nodeMeta.path as string) || '';
          const metaFingerprint = (nodeMeta.fingerprint as string) || '';
          const metaScope = ((nodeMeta.definitionScope as string) || '').trim();
          const metaDefinitionName = ((nodeMeta.definitionName as string) || '').trim();
          const metaOperationId = ((nodeMeta.operationId as string) || '').trim();
          const methodPathKey = metaMethod && metaPath ? `${metaScope}|${metaMethod}|${metaPath}` : '';
          const operationScopeKey = metaOperationId ? `${metaScope}|${metaOperationId}` : '';
          const pathScopeKey = metaPath ? `${metaScope}|${metaPath}` : '';

          let warningText: string | null = null;

          if (metaFingerprint && latestFingerprintSet.has(metaFingerprint)) {
            warningText = null;
          } else if (methodPathKey && latestMethodPathSet.has(methodPathKey)) {
            warningText = null;
          } else if (operationScopeKey && latestByOperationId.has(operationScopeKey)) {
            const latestMeta = latestByOperationId.get(operationScopeKey)!;
            warningText = `Endpoint changed in Swagger docs (${metaMethod} ${metaPath} -> ${latestMeta.method} ${latestMeta.path}).`;
          } else if (pathScopeKey && latestMethodsByPath.has(pathScopeKey)) {
            const availableMethods = Array.from(latestMethodsByPath.get(pathScopeKey)!).join(', ');
            warningText = `Method mismatch for ${metaPath}. Available method(s): ${availableMethods}.`;
          } else {
            warningText = `Endpoint no longer found in Swagger docs (${metaMethod} ${metaPath}).`;
          }

          if (warningText && metaDefinitionName) {
            warningText = `[${metaDefinitionName}] ${warningText}`;
          }

          if (!warningText) {
            if (!existingWarning) {
              return node;
            }
            didChange = true;
            const restData = { ...node.data! };
            delete restData.schemaRefreshWarning;
            return {
              ...node,
              data: restData,
            };
          }

          const warningPayload = {
            text: warningText,
            sourceUrl: swaggerDocUrl,
            refreshedAt: new Date().toISOString(),
            endpointFingerprint: metaFingerprint || null,
          };

          if (
            existingWarning &&
            existingWarning.text === warningPayload.text &&
            existingWarning.sourceUrl === warningPayload.sourceUrl
          ) {
            return node;
          }

          didChange = true;
          return {
            ...node,
            data: {
              ...node.data,
              schemaRefreshWarning: warningPayload,
            },
          };
        });
        return didChange ? nextNodes : currentNodes;
      });

      if (showSuccessToast) {
        const summary = buildSwaggerRefreshSummary(result?.stats || {}, items.length);
        toast.success(summary.successMessage);

        if (summary.warningMessage) {
          toast.warning(summary.warningMessage);
        }
      }

      return { endpointCount: items.length };
    } catch (error) {
      if (requestId === swaggerRefreshRequestIdRef.current) {
        removeImportedGroup(envSwaggerGroupId);
      }
      const errorMessage = error instanceof Error ? error.message : 'Failed to refresh nodes from environment Swagger URL';
      toast.error(errorMessage);
      return { error: errorMessage };
    } finally {
      if (requestId === swaggerRefreshRequestIdRef.current) {
        setIsSwaggerRefreshing(false);
      }
    }
  }, [
    workflowId,
    selectedEnvironment,
    environments,
    envSwaggerGroupId,
    addImportedGroup,
    removeImportedGroup,
    setNodes,
    clearSwaggerWarningOnCanvas,
  ]);

  useEffect(() => {
    return () => {
      swaggerRefreshRequestIdRef.current += 1;
      removeImportedGroup(envSwaggerGroupId);
    };
  }, [envSwaggerGroupId, removeImportedGroup]);

  useEffect(() => {
    refreshSwaggerTemplates();
  }, [refreshSwaggerTemplates]);

  const handleManualSwaggerRefresh = useCallback(() => {
    refreshSwaggerTemplates({ force: true, showSuccessToast: true });
  }, [refreshSwaggerTemplates]);

  const reloadVersion = useCanvasStore((s) => s.reloadVersion);
  const reloadWorkflowId = useCanvasStore((s) => s.reloadWorkflowId);
  useEffect(() => {
    if (reloadVersion > 0 && reloadWorkflowId === workflowId) {
      (async () => {
        try {
          const response = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}`);
          if (response.ok) {
            const data = await response.json() as {
              nodes?: Array<{ nodeId: string; type: string; position: { x: number; y: number }; config?: Record<string, unknown>; label?: string }>;
              edges?: Array<{ edgeId: string; source: string; target: string; sourceHandle?: string; targetHandle?: string; label?: string }>;
            };
            const newNodes = (data.nodes || []).map(node => ({
              id: node.nodeId,
              type: node.type,
              position: node.position,
              data: {
                config: node.config || {},
                label: node.label,
              },
            })) as Node<NodeData>[];
            const newEdges: Edge<EdgeData>[] = (data.edges || []).map(edge => ({
              id: edge.edgeId,
              source: edge.source,
              target: edge.target,
              sourceHandle: edge.sourceHandle || null,
              targetHandle: edge.targetHandle || null,
              label: edge.label,
              type: 'custom',
              ...(edge.sourceHandle === 'pass' || edge.sourceHandle === 'fail' ? {
                animated: true,
                style: {
                  stroke: edge.sourceHandle === 'pass'
                    ? assertionEdgeColor('pass')
                    : assertionEdgeColor('fail'),
                  strokeWidth: 2,
                },
                labelStyle: {
                  fill: edge.sourceHandle === 'pass'
                    ? assertionEdgeColor('pass')
                    : assertionEdgeColor('fail'),
                  fontWeight: 700,
                  fontSize: 11,
                },
                labelBgStyle: {
                  fill: edgeLabelBackground,
                  fillOpacity: 0.95,
                },
                labelBgPadding: [6, 4],
                labelBgBorderRadius: 4,
              } : {}),
            }));
            setNodes(newNodes);
            setEdges(newEdges);
          }
        } catch (err) {
          console.error('Error reloading workflow:', err);
        }
      })();
    }
  }, [reloadVersion, reloadWorkflowId, workflowId, setNodes, setEdges]);

  const pendingAction = useCanvasStore((s) => s.pendingAction);
  useEffect(() => {
    if (!pendingAction) return;
    const { type, nodeId } = pendingAction;

    if (type === 'duplicate' && nodeId) {
      const nodeToClone = nodes.find((n) => n.id === nodeId);
      if (nodeToClone) {
        const newNode: Node<NodeData> = {
          ...nodeToClone,
          id: `${nodeToClone.id}-${Date.now()}`,
          position: {
            x: nodeToClone.position.x + 150,
            y: nodeToClone.position.y + 150,
          },
          data: {
            ...nodeToClone.data,
            config: nodeToClone.data.config
              ? JSON.parse(JSON.stringify(nodeToClone.data.config))
              : {},
          },
        };
        setNodes((nds) => [...nds, newNode]);
      }
    } else if (type === 'copy' && nodeId) {
      const nodeToClone = nodes.find((n) => n.id === nodeId);
      if (nodeToClone) {
        const cloneData = {
          type: nodeToClone.type,
          data: JSON.parse(JSON.stringify(nodeToClone.data)),
        };
        useCanvasStore.getState().setClipboardNode(cloneData as unknown as import('../types').ClipboardNodeData);
      }
    } else if (type === 'paste') {
      const cloneData = sessionStorage.getItem('copiedNode');
      if (!cloneData) {
        toast.error('No node in clipboard');
      } else {
        try {
          const { type: nodeType, data } = JSON.parse(cloneData) as { type: string; data: Record<string, unknown> };
          let newPosition = { x: 400, y: 300 };
          if (selectedNode) {
            newPosition = { x: selectedNode.position.x + 200, y: selectedNode.position.y + 150 };
          } else if (nodes.length > 0) {
            const lastNode = nodes[nodes.length - 1]!;
            newPosition = { x: lastNode.position.x + 150, y: lastNode.position.y + 150 };
          }
          setNodes((nds) => [...nds, { id: `node-${Date.now()}`, type: nodeType, position: newPosition, data }]);
          toast.success('Node pasted successfully');
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          toast.error('Error pasting node: ' + errorMessage);
        }
      }
    }
    useCanvasStore.getState().clearPendingAction();
  }, [pendingAction, nodes, setNodes, selectedNode]);

  useEffect(() => {
    const isEditorOverlayOpen = !!modalNode || showJsonEditor || showImportToNodes || showHistory || showSecretsPrompt;

    const handleKeyDown = (e: KeyboardEvent) => {
      const action = getCanvasClipboardShortcutAction({
        event: e,
        hasSelectedNode: !!selectedNode,
        isEditorOverlayOpen,
      });
      if (!action) return;

      if (action === 'copy' && selectedNode) {
        e.preventDefault();
        useCanvasStore.getState().copyNode(selectedNode.id);
        toast.success('Node copied to clipboard');
      }

      if (action === 'paste') {
        e.preventDefault();
        useCanvasStore.getState().pasteNode();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNode, modalNode, showJsonEditor, showImportToNodes, showHistory, showSecretsPrompt]);

  useEffect(() => {
    const branchCounts: Record<string, number> = {};
    edges.forEach(edge => {
      branchCounts[edge.source] = (branchCounts[edge.source] || 0) + 1;
    });

    const incomingCounts: Record<string, number> = {};
    const incomingEdgesMap: Record<string, Edge<EdgeData>[]> = {};
    edges.forEach(edge => {
      incomingCounts[edge.target] = (incomingCounts[edge.target] || 0) + 1;
      if (!incomingEdgesMap[edge.target]) {
        incomingEdgesMap[edge.target] = [];
      }
      incomingEdgesMap[edge.target]!.push(edge);
    });

    const branchesEqual = (
      left: Array<{ index: number; nodeId: string; label: string; edgeLabel: string }> | undefined,
      right: Array<{ index: number; nodeId: string; label: string; edgeLabel: string }> | undefined,
    ): boolean => {
      if (left === right) return true;
      if (!left || !right) return false;
      if (left.length !== right.length) return false;
      for (let i = 0; i < left.length; i += 1) {
        const l = left[i]!;
        const r = right[i]!;
        if (
          l.index !== r.index ||
          l.nodeId !== r.nodeId ||
          l.label !== r.label ||
          l.edgeLabel !== r.edgeLabel
        ) {
          return false;
        }
      }
      return true;
    };

    setNodes(nds => {
      let didChange = false;
      const nextNodes = nds.map(node => {
        const nextBranchCount = branchCounts[node.id] || 0;
        const nextIncomingBranchCount = incomingCounts[node.id] || 0;
        const prevData = node.data || {};

        let nextIncomingBranches = prevData.incomingBranches;
        let incomingBranchesChanged = false;

        if (node.type === 'merge' && incomingEdgesMap[node.id]) {
          nextIncomingBranches = incomingEdgesMap[node.id]!.map((edge, idx) => {
            const sourceNode = nds.find(n => n.id === edge.source);
            return {
              index: idx,
              nodeId: edge.source,
              label: sourceNode?.data?.label || edge.source,
              edgeLabel: (edge.label as string) || `Branch ${idx}`
            };
          });
          incomingBranchesChanged = !branchesEqual(prevData.incomingBranches, nextIncomingBranches);
        }

        const baseChanged =
          prevData.branchCount !== nextBranchCount ||
          prevData.incomingBranchCount !== nextIncomingBranchCount;

        if (!baseChanged && !incomingBranchesChanged) {
          return node;
        }

        didChange = true;
        return {
          ...node,
          data: {
            ...prevData,
            branchCount: nextBranchCount,
            incomingBranchCount: nextIncomingBranchCount,
            ...(incomingBranchesChanged ? { incomingBranches: nextIncomingBranches } : {})
          }
        };
      });

      return didChange ? nextNodes : nds;
    });
  }, [edges, setNodes]);

  useEffect(() => {
    if (!workflow || !Array.isArray(workflow.nodes) || !Array.isArray(workflow.edges)) {
      setIsWorkflowHydrated(false);
      return;
    }

    const loadedNodes = workflow.nodes.map((node, index) => ({
      id: node.nodeId ?? node.id ?? `node-${index}`,
      type: node.type ?? 'http-request',
      position: node.position,
      data: {
        label: node.label ?? node.data?.label,
        config: node.config ?? node.data?.config ?? {},
      },
    })) as Node<NodeData>[];

    const loadedEdges = workflow.edges.map((edge, index) => ({
      id: edge.edgeId ?? edge.id ?? `edge-${index}`,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || null,
      targetHandle: edge.targetHandle || null,
      label: edge.label,
      type: 'custom',
      ...(edge.sourceHandle === 'pass' || edge.sourceHandle === 'fail' ? {
        animated: true,
        style: {
          stroke: edge.sourceHandle === 'pass'
            ? assertionEdgeColor('pass')
            : assertionEdgeColor('fail'),
          strokeWidth: 2,
        },
        labelStyle: {
          fill: edge.sourceHandle === 'pass'
            ? assertionEdgeColor('pass')
            : assertionEdgeColor('fail'),
          fontWeight: 700,
          fontSize: 11,
        },
        labelBgStyle: {
          fill: edgeLabelBackground,
          fillOpacity: 0.95,
        },
        labelBgPadding: [6, 4],
        labelBgBorderRadius: 4,
      } : {}),
    })) as Edge<EdgeData>[];

    setNodes(loadedNodes);
    setEdges(loadedEdges);
    setIsWorkflowHydrated(true);
    hydratedBaselineRef.current = {
      nodeCount: loadedNodes.length,
      edgeCount: loadedEdges.length,
    };
  }, [workflow, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => {
        const currentNodes = nodesRef.current;
        const sourceNode = currentNodes.find(n => n.id === params.source);
        const isAssertionSource = sourceNode?.type === 'assertion';

        if (isAssertionSource && params.sourceHandle) {
          const isPass = params.sourceHandle === 'pass';
          const label = isPass ? 'Pass' : 'Fail';
          const color = assertionEdgeColor(params.sourceHandle);

          const newEdge = {
            id: `reactflow__edge-${params.source}${params.sourceHandle || ''}-${params.target}${params.targetHandle || ''}`,
            ...params,
            type: 'custom',
            animated: true,
            label,
            style: { stroke: color, strokeWidth: 2 },
            labelStyle: {
              fill: color,
              fontWeight: 700,
              fontSize: 11,
            },
            labelBgStyle: {
              fill: edgeLabelBackground,
              fillOpacity: 0.95,
            },
            labelBgPadding: [6, 4],
            labelBgBorderRadius: 4,
          } as Edge<EdgeData>;
          return [...eds, newEdge];
        }

        const newEdge = addEdge({ ...params, type: 'custom' } as Parameters<typeof addEdge>[0], eds)[eds.length];

        const parallelEdges = eds.filter(e => e.source === params.source);

        if (parallelEdges.length > 0) {
          const updatedEdges = eds.map((e): Edge<EdgeData> => {
            if (e.source === params.source) {
              const branchIndex = parallelEdges.findIndex(pe => pe.id === e.id);
              return {
                ...e,
                animated: true,
                style: {
                  stroke: branchEdgeColor,
                  strokeWidth: 2
                },
                label: `Branch ${branchIndex}`,
                labelStyle: {
                  fill: branchLabelColor,
                  fontWeight: 600,
                  fontSize: 11
                },
                labelBgStyle: {
                  fill: edgeLabelBackground,
                  fillOpacity: 0.95
                },
                labelBgPadding: [6, 4],
                labelBgBorderRadius: 4
              } as Edge<EdgeData>;
            }
            return e;
          }).concat([{
            ...newEdge,
            type: 'custom',
            animated: true,
            style: {
              stroke: branchEdgeColor,
              strokeWidth: 2
            },
            label: `Branch ${parallelEdges.length}`,
            labelStyle: {
              fill: branchLabelColor,
              fontWeight: 600,
              fontSize: 11
            },
            labelBgStyle: {
              fill: edgeLabelBackground,
              fillOpacity: 0.95
            },
            labelBgPadding: [6, 4],
            labelBgBorderRadius: 4
          } as Edge<EdgeData>]);
          return updatedEdges as Edge<EdgeData>[];
        }

        return addEdge({ ...params, type: 'custom' } as Parameters<typeof addEdge>[0], eds) as Edge<EdgeData>[];
      });
    },
    [setEdges]
  );

  const handleNodesChange = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    const filteredChanges = changes.filter((change) => {
      if (change.type === 'select' && newDuplicateNodeRef.current === change.id) {
        return false;
      }
      return true;
    });
    onNodesChangeRef.current(filteredChanges);
  }, []);

  const handleEdgesChange = useCallback((changes: Parameters<typeof onEdgesChange>[0]) => {
    onEdgesChangeRef.current(changes);
  }, []);

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node<NodeData>) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const onNodeDragStart = useCallback(() => {
    setIsDraggingNode(true);
  }, []);

  const onNodeDragStop = useCallback(() => {
    setIsDraggingNode(false);
  }, []);

  const onNodeDoubleClick = useCallback((_event: React.MouseEvent, node: Node<NodeData>) => {
    if (node.type !== 'start' && node.type !== 'end') {
      setModalNode(node);
    }
  }, []);

  const handleModalSave = useCallback((updatedNode: Node<NodeData>) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === updatedNode.id ? updatedNode : n))
    );
  }, [setNodes]);

  const { onDrop, onDragOver } = useCanvasDrop({ reactFlowInstanceRef, setNodes });

  const saveWorkflow = useCallback(async (silent = false) => {
    const workflowPayload = {
      nodes: nodesRef.current.map(node => ({
        nodeId: node.id,
        type: node.type ?? '',
        label: node.data.label,
        position: node.position,
        config: node.data.config || {},
      })),
      edges: edgesRef.current.map(edge => ({
        edgeId: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
        label: typeof edge.label === 'string' ? edge.label : null,
      })),
      variables: workflowVariablesRef.current,
    };

    const nodeCount = workflowPayload.nodes.length;
    const edgeCount = workflowPayload.edges.length;
    if (silent && shouldBlockDestructiveAutosave(workflowPayload.nodes, workflowPayload.edges, hydratedBaselineRef.current)) {
      console.warn('[workflow-save-blocked]', {
        workflowId,
        reason: 'destructive-autosave-protection',
        baseline: hydratedBaselineRef.current,
        nodeCount,
        edgeCount,
      });
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflowPayload),
      });

      if (response.ok) {
        hydratedBaselineRef.current = { nodeCount, edgeCount };
        useTabStore.getState().markClean(workflowId ?? '');
      } else {
        console.error('Failed to save workflow');
      }
    } catch (error) {
      console.error('Save error:', error);
    }
  }, [workflowId, workflow]);

  const workflowJsonMemo = useMemo((): WorkflowJsonData => ({
    nodes: nodes.map(node => ({
      nodeId: node.id,
      type: node.type ?? '',
      ...(node.data.label ? { label: node.data.label } : {}),
      position: node.position,
      config: node.data.config || {},
    })),
    edges: edges.map(edge => ({
      edgeId: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
      ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
      ...(typeof edge.label === 'string' ? { label: edge.label } : {}),
    })),
    variables: workflowVariables,
  }), [nodes, edges, workflowVariables]);

  const handleJsonApply = useCallback(async (parsed: Record<string, unknown>) => {
    const parsedNodes = (parsed.nodes || []) as Array<{ nodeId: string; type: string; position: { x: number; y: number }; label?: string; config?: Record<string, unknown> }>;
    const parsedEdges = (parsed.edges || []) as Array<{ edgeId: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; label?: string }>;

    const newNodes = parsedNodes.map(node => ({
      id: node.nodeId,
      type: node.type,
      position: node.position,
      data: {
        label: node.label,
        config: node.config || {},
      },
    })) as Node<NodeData>[];

    const newEdges = parsedEdges.map(edge => ({
      id: edge.edgeId,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
      label: edge.label,
      type: 'custom',
      ...(edge.sourceHandle === 'pass' || edge.sourceHandle === 'fail' ? {
        animated: true,
        style: {
          stroke: edge.sourceHandle === 'pass'
            ? assertionEdgeColor('pass')
            : assertionEdgeColor('fail'),
          strokeWidth: 2,
        },
        labelStyle: {
          fill: edge.sourceHandle === 'pass'
            ? assertionEdgeColor('pass')
            : assertionEdgeColor('fail'),
          fontWeight: 700,
          fontSize: 11,
        },
        labelBgStyle: {
          fill: edgeLabelBackground,
          fillOpacity: 0.95,
        },
        labelBgPadding: [6, 4],
        labelBgBorderRadius: 4,
      } : {}),
    })) as Edge<EdgeData>[];

    try {
      const response = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: parsed.nodes,
          edges: parsed.edges,
          variables: parsed.variables || workflowVariables,
        }),
      });
      if (response.ok) {
        hydratedBaselineRef.current = {
          nodeCount: Array.isArray(parsed.nodes) ? parsed.nodes.length : 0,
          edgeCount: Array.isArray(parsed.edges) ? parsed.edges.length : 0,
        };
        setNodes(newNodes);
        setEdges(newEdges);

        const parsedVars = parsed.variables as Record<string, unknown> | undefined;
        if (parsedVars && typeof parsedVars === 'object') {
          Object.entries(parsedVars).forEach(([k, v]) => updateVariable(k, v));
        }

        setShowJsonEditor(false);
        toast.success('Workflow updated from JSON editor');
      } else {
        try {
          const errBody = await response.json() as { detail?: string | Array<{ loc?: string[]; msg?: string }> };
          if (errBody.detail && Array.isArray(errBody.detail)) {
            const messages = errBody.detail.map(d => {
              const loc = d.loc ? d.loc.slice(1).join(' → ') : '';
              return `${loc}: ${d.msg}`;
            });
            toast.error(messages.join('\n'));
          } else {
            toast.error((errBody.detail as string) || `Save failed (${response.status})`);
          }
        } catch {
          toast.error(`Save failed with status ${response.status}`);
        }
      }
    } catch (err) {
      console.error('JSON editor save error:', err);
      toast.error('Network error — see console');
    }
  }, [setNodes, setEdges, workflowId, workflowVariables, updateVariable, workflow]);

  useAutoSave({
    workflowId,
    autoSaveEnabled: autoSaveEnabled && !isDraggingNode && !isRunning && !isSwaggerRefreshing,
    isHydrated: isWorkflowHydrated,
    nodes,
    edges,
    workflowVariables,
    saveWorkflow,
  });

  const getNodeColor = useCallback((n: Node<NodeData>) => {
    if (n.data?.executionStatus === 'running') return 'var(--aw-status-info)';
    if (n.data?.executionStatus === 'success') return 'var(--aw-status-success)';
    if (n.data?.executionStatus === 'error') return 'var(--aw-status-error)';

    if (n.type === 'start') return 'var(--aw-primary-light)';
    if (n.type === 'end') return 'var(--aw-status-error)';
    if (n.type === 'httpRequest' || n.type === 'http-request') return 'var(--aw-status-info)';
    if (n.type === 'assertion') return 'var(--aw-status-success)';
    if (n.type === 'delay') return 'var(--aw-status-warning)';
    if (n.type === 'merge') return 'var(--aw-branch-edge)';

    return 'var(--aw-text-muted)';
  }, []);

  const getNodeStrokeColor = useCallback((n: Node<NodeData>) => {
    if (n.data?.executionStatus === 'error') return 'var(--aw-status-error)';
    return 'var(--aw-border)';
  }, []);

  const miniMapStyle = useMemo(() => ({
    backgroundColor: 'var(--aw-surface-raised)',
    border: '2px solid var(--aw-border-focus)',
    borderRadius: '8px',
    width: 220,
    height: 150,
  }), []);

  const miniMapMaskColor = useMemo(
    () => (darkMode ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.05)'),
    [darkMode],
  );

  const defaultEdgeOptions = useMemo(
    () => ({ type: 'custom' as const, animated: true }),
    [],
  );

  const reactFlowStyle = useMemo(
    () => ({ width: '100%', height: '100%' }),
    [],
  );

  const fitViewOptions = useMemo(
    () => ({
      padding: 0.25,
      minZoom: 0.02,
      includeHiddenNodes: true,
    }),
    [],
  );

  const rfInstanceRef = useRef<Parameters<NonNullable<Parameters<typeof ReactFlow>[0]['onInit']>>[0] | null>(null);

  return (
    <div className="w-full h-full min-h-0 relative bg-surface dark:bg-surface-dark transition-colors" role="main" aria-label="Workflow canvas">
      <ReactFlow
        style={reactFlowStyle}
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={onNodeDoubleClick}
        onInit={(instance) => {
          rfInstanceRef.current = instance;
          (reactFlowInstanceRef as React.MutableRefObject<unknown>).current = instance;
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        fitViewOptions={fitViewOptions}
        minZoom={0.02}
        maxZoom={2.5}
        deleteKeyCode="Delete"
        multiSelectionKeyCode="Control"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={12}
          size={1}
          color="var(--aw-text-muted)"
        />

        <Controls
          position="bottom-left"
          fitViewOptions={fitViewOptions}
          className="border border-border-default dark:border-border-default-dark shadow-md rounded-lg"
        />

        <Panel position="bottom-right" style={{ bottom: 10, right: 10 }}>
          <MiniMap
            nodeColor={getNodeColor}
            nodeStrokeColor={getNodeStrokeColor}
            nodeStrokeWidth={2}
            maskColor={miniMapMaskColor}
            style={miniMapStyle}
            zoomable
            pannable
          />
        </Panel>
      </ReactFlow>

      <CanvasToolbar
        onSave={() => saveWorkflow(false)}
        onHistory={() => setShowHistory(true)}
        onJsonEditor={() => {
          if (!isWorkflowHydrated) {
            toast.info('Workflow is still loading. Try JSON again in a moment.');
            return;
          }
          setShowJsonEditor(true);
        }}
        onImport={() => setShowImportToNodes(true)}
        onRun={runWorkflow}
        onRunFromLastFailed={runFromLastFailed}
        onRunAllFailed={runAllFailed}
        onRunFromFailedNode={(nodeId) => {
          if (resumeSourceRunId) {
            runFromFailedNodes([nodeId], resumeSourceRunId, 'single');
          }
        }}
        isRunning={isRunning}
        environments={environments}
        {...(selectedEnvironment ? { selectedEnvironment } : {})}
        onRefreshSwagger={handleManualSwaggerRefresh}
        isSwaggerRefreshing={isSwaggerRefreshing}
        resumeOptions={resumeOptions}
        isResumeLoading={isResumeLoading}
        onEnvironmentChange={(val) => {
          const processed = (val && val.trim()) ? val.trim() : null;
          const selectedEnv = processed ? environments.find(e => e.environmentId === processed) : undefined;
          const envName = selectedEnv ? selectedEnv.name : 'No Environment';
          setSelectedEnvironment(processed);
          toast.success(`Environment: ${envName}`);
        }}
        workflowId={workflowId ?? ''}
      />

      <AddNodesPanel isModalOpen={!!modalNode} showVariablesPanel={showVariablesPanel} onShowVariablesPanel={onShowVariablesPanel} />

      <NodeModal
        open={!!modalNode}
        node={modalNode ? {
          ...modalNode,
          type: modalNode.type as 'http-request' | 'assertion' | 'delay' | 'merge' | 'start' | 'end',
          data: {
            ...modalNode.data,
            label: String(modalNode.data.label || ''),
            config: (modalNode.data.config as Record<string, unknown>) || {},
          },
        } : { id: 'start-1', type: 'start' as const, position: { x: 0, y: 0 }, data: { label: 'Start', config: {} } }}
        onClose={() => setModalNode(null)}
        onSave={(node) => handleModalSave(node as Node<NodeData>)}
      />

      {showHistory && (
        <HistoryModal
          workflowId={workflowId ?? ''}
          onClose={() => setShowHistory(false)}
          onSelectRun={loadHistoricalRun}
        />
      )}

      {showImportToNodes && (
        <ImportToNodesPanel
          isOpen={showImportToNodes}
          onClose={() => setShowImportToNodes(false)}
          workflowId={workflowId ?? ''}
        />
      )}

      <WorkflowJsonEditor
        open={showJsonEditor}
        workflowJson={showJsonEditor ? (workflowJsonMemo as unknown as Record<string, unknown>) : null}
        onApply={handleJsonApply}
        onClose={() => {
          setShowJsonEditor(false);
        }}
      />

      <SecretsPrompt
        isOpen={showSecretsPrompt && !!selectedEnvironment?.trim() && !!environments.find(e => e.environmentId === selectedEnvironment.trim())}
        environment={selectedEnvironment?.trim() ? (environments.find(e => e.environmentId === selectedEnvironment.trim()) ?? null) : null}
        onClose={() => { setShowSecretsPrompt(false); pendingRunRef.current = null; }}
        onSecretsProvided={handleSecretsProvided}
      />

    </div>
  );
}

export default WorkflowCanvas;
