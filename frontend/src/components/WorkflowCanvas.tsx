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
import { AppContext } from '../App';
import { useWorkflow } from '../contexts/WorkflowContext';
import { toast } from 'sonner';
import { CanvasToolbar } from './organisms/CanvasToolbar';
import useTabStore from '../stores/TabStore';
import useCanvasStore from '../stores/CanvasStore';
import useSidebarStore from '../stores/SidebarStore';
import useAutoSave from '../hooks/useAutoSave';
import useCanvasDrop from '../hooks/useCanvasDrop';
import useWorkflowPolling from '../hooks/useWorkflowPolling';
import { useClipboardActions } from '../hooks/useClipboardActions';
import { useHydration, assertionEdgeColor, edgeLabelBackground } from '../hooks/useHydration';
import { useNodeBranchCounts } from '../hooks/useNodeBranchCounts';
import { useSwaggerRefresh } from '../hooks/useSwaggerRefresh';
import { shouldBlockDestructiveAutosave } from '../utils/workflowSaveSafety';
import { environmentsUrl, workflowDetailUrl } from '../utils/scopedApi';
import { useScopeContext } from '../hooks/useScopeContext';
import type { WorkflowCanvasNodeData } from '../types/WorkflowCanvasNodeData';
import type { WorkflowCanvasEdgeData } from '../types/WorkflowCanvasEdgeData';
import type { WorkflowCanvasProps } from '../types/WorkflowCanvasProps';
import type { EnvironmentWithSwagger } from '../types/EnvironmentWithSwagger';
import type { WorkflowJsonData } from '../types/WorkflowJsonData';
import { authenticatedFetch } from '../utils/authenticatedApi';

const branchEdgeColor = 'var(--aw-branch-edge)';
const branchLabelColor = 'var(--aw-branch-label)';

const NOISE_DATA_URI =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 240 240' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

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

// Module-scope on purpose: inline definitions create new refs every render and re-trigger ReactFlow layout work during pan/drag.
const reactFlowStyle = { width: '100%', height: '100%' };

const defaultEdgeOptions = { type: 'custom' as const, animated: false };

const fitViewOptions = {
  padding: 0.25,
  minZoom: 0.02,
  includeHiddenNodes: true,
};

const miniMapStyle = {
  backgroundColor: 'var(--aw-surface-raised)',
  border: '1px solid var(--aw-border)',
  borderRadius: 'var(--aw-radius-sm)',
  width: 220,
  height: 150,
};

// WeakMap IDs track extractor-config identity by ref so the signature doesn't churn during position-only drag frames.
const extractorConfigIdMap = new WeakMap<object, number>();
let nextExtractorConfigId = 0;

const initialNodes: Node<WorkflowCanvasNodeData>[] = [
  {
    id: 'start-1',
    type: 'start',
    position: { x: 250, y: 50 },
    data: { label: 'Start' },
  },
];

export function WorkflowCanvas({
  workflowId,
  workflow,
  showVariablesPanel = false,
  onShowVariablesPanel = () => {},
}: WorkflowCanvasProps) {
  const context = useContext(AppContext);
  const { darkMode, autoSaveEnabled } = context || { darkMode: false, autoSaveEnabled: true };
  const scope = useScopeContext();

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

  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowCanvasNodeData>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<WorkflowCanvasEdgeData>([]);

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

  const reactFlowInstanceRef = useRef<ReactFlowInstance<WorkflowCanvasNodeData, WorkflowCanvasEdgeData> | null>(null) as MutableRefObject<ReactFlowInstance<WorkflowCanvasNodeData, WorkflowCanvasEdgeData> | null>;
  const [modalNode, setModalNode] = useState<Node<WorkflowCanvasNodeData> | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showImportToNodes, setShowImportToNodes] = useState(false);
  const [showJsonEditor, setShowJsonEditor] = useState(false);
  const [environments, setEnvironments] = useState<EnvironmentWithSwagger[]>([]);

  const [selectedEnvironmentByWorkflow, setSelectedEnvironmentByWorkflow] = useState<Record<string, string | null>>({});
  const selectedEnvironment = useMemo<string | null>(() => {
    const workflowKey = workflowId ?? '';
    const workflowSpecific = selectedEnvironmentByWorkflow[workflowKey];
    if (workflowSpecific !== undefined) {
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
  }, [workflowId, workflow?.environmentId, selectedEnvironmentByWorkflow]);

  // ── Hooks ──────────────────────────────────────────────────────────

  const isEditorOverlayOpen = !!modalNode || showJsonEditor || showImportToNodes || showHistory;

  const { selectedNodeRef, newDuplicateNodeRef } = useClipboardActions({
    nodes,
    setNodes,
    isEditorOverlayOpen,
  });

  const { isWorkflowHydratedRef, hydratedBaselineRef } = useHydration({
    workflow,
    setNodes,
    setEdges,
  });

  useNodeBranchCounts({
    edges,
    nodes,
    setNodes,
  });

  const { isSwaggerRefreshing, handleManualSwaggerRefresh } = useSwaggerRefresh({
    workflowId,
    selectedEnvironment,
    environments,
    setNodes,
  });

  const {
    isRunning,
    runWorkflow,
    runFromLastFailed,
    runAllFailed,
    runFromFailedNodes,
    resumeOptions,
    resumeSourceRunId,
    isResumeLoading,
    loadHistoricalRun,
  } = useWorkflowPolling({
    workspaceId: scope.workspaceId,
    workflowId,
    nodes,
    setNodes,
    selectedEnvironment,
    reactFlowInstanceRef,
  });

  // ── Extractors effect ───────────────────────────────────────────────

  const extractorsSig = useMemo(() => {
    const parts: string[] = [];
    for (const node of nodes) {
      if (node.type === 'http-request' && node.data?.config?.extractors) {
        const extractors = node.data.config.extractors as object;
        let id = extractorConfigIdMap.get(extractors);
        if (id === undefined) {
          id = nextExtractorConfigId++;
          extractorConfigIdMap.set(extractors, id);
        }
        parts.push(`${node.id}:${id}`);
      }
    }
    return parts.join('|');
  }, [nodes]);

  useEffect(() => {
    const extractorsFromNodes: Record<string, unknown> = {};
    nodesRef.current.forEach(node => {
      if (node.type === 'http-request' && node.data?.config?.extractors) {
        Object.assign(extractorsFromNodes, node.data.config.extractors);
      }
    });
    registerExtractors(extractorsFromNodes);
  }, [extractorsSig, registerExtractors]);

  // ── Variables deletion effect ───────────────────────────────────────

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

  // ── Environments fetching ───────────────────────────────────────────

  const fetchEnvironments = useCallback(async () => {
    if (!scope.isReady || !scope.workspaceId) {
      setEnvironments([]);
      return;
    }

    try {
      const response = await authenticatedFetch(
        environmentsUrl(scope.workspaceId, 'all-accessible', scope.orgId),
      );
      if (response.ok) {
        const data = await response.json() as EnvironmentWithSwagger[];
        setEnvironments(data);
      }
    } catch (error) {
      console.error('Error fetching environments:', error);
    }
  }, [scope.isReady, scope.orgId, scope.workspaceId]);

  useEffect(() => {
    void fetchEnvironments();
  }, [fetchEnvironments]);

  const environmentVersion = useSidebarStore((s) => s.environmentVersion);
  useEffect(() => {
    if (environmentVersion > 0) {
      void fetchEnvironments();
    }
  }, [environmentVersion, fetchEnvironments]);

  // ── Workflow reload from server ─────────────────────────────────────

  const reloadWorkflowFromServer = useCallback(async () => {
    if (!workflowId || !scope.workspaceId) return;

    try {
      const response = await authenticatedFetch(workflowDetailUrl(scope.workspaceId, workflowId));
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
        })) as Node<WorkflowCanvasNodeData>[];
        const newEdges: Edge<WorkflowCanvasEdgeData>[] = (data.edges || []).map(edge => ({
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
      strokeWidth: 1,
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
            labelBgPadding: [6, 4] as [number, number],
            labelBgBorderRadius: 4,
          } : {}),
        }));
        setNodes(newNodes);
        setEdges(newEdges);
      }
    } catch (err) {
      console.error('Error reloading workflow:', err);
    }
  }, [workflowId, scope.workspaceId, setNodes, setEdges]);

  useEffect(() => {
    if (!workflowId) return;

    return useCanvasStore.getState().registerWorkflowReloadHandler(workflowId, () => {
      void reloadWorkflowFromServer();
    });
  }, [reloadWorkflowFromServer, workflowId]);

  // ── Node change handlers ────────────────────────────────────────────

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

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node<WorkflowCanvasNodeData>) => {
    selectedNodeRef.current = node;
  }, []);

  const onPaneClick = useCallback(() => {
    selectedNodeRef.current = null;
  }, []);

  const onNodeDragStart = useCallback(() => {
    // isDraggingNodeRef removed — auto-save skips during drag via isSwaggerRefreshing guard
  }, []);

  const onNodeDragStop = useCallback(() => {
    // Drag stop handler — no-op, auto-save resumes naturally
  }, []);

  const onNodeDoubleClick = useCallback((_event: React.MouseEvent, node: Node<WorkflowCanvasNodeData>) => {
    if (node.type !== 'start' && node.type !== 'end') {
      setModalNode(node);
    }
  }, []);

  const handleModalSave = useCallback((updatedNode: Node<WorkflowCanvasNodeData>) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === updatedNode.id ? updatedNode : n))
    );
  }, [setNodes]);

  // ── Canvas drop ─────────────────────────────────────────────────────

  const { onDrop, onDragOver } = useCanvasDrop({ reactFlowInstanceRef, setNodes });

  // ── Connect handler ─────────────────────────────────────────────────

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
            labelBgPadding: [6, 4] as [number, number],
            labelBgBorderRadius: 4,
          } as Edge<WorkflowCanvasEdgeData>;
          return [...eds, newEdge];
        }

        const newEdge = addEdge({ ...params, type: 'custom' } as Parameters<typeof addEdge>[0], eds)[eds.length];

        const parallelEdges = eds.filter(e => e.source === params.source);

        if (parallelEdges.length > 0) {
          const updatedEdges = eds.map((e): Edge<WorkflowCanvasEdgeData> => {
            if (e.source === params.source) {
              const branchIndex = parallelEdges.findIndex(pe => pe.id === e.id);
              return {
                ...e,
                animated: true,
                style: {
                  stroke: branchEdgeColor,
      strokeWidth: 1
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
                labelBgPadding: [6, 4] as [number, number],
                labelBgBorderRadius: 4
              } as Edge<WorkflowCanvasEdgeData>;
            }
            return e;
          }).concat([{
            ...newEdge,
            type: 'custom',
            animated: true,
            style: {
              stroke: branchEdgeColor,
              strokeWidth: 1
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
            labelBgPadding: [6, 4] as [number, number],
            labelBgBorderRadius: 4
          } as Edge<WorkflowCanvasEdgeData>]);
          return updatedEdges as Edge<WorkflowCanvasEdgeData>[];
        }

        return addEdge({ ...params, type: 'custom' } as Parameters<typeof addEdge>[0], eds) as Edge<WorkflowCanvasEdgeData>[];
      });
    },
    [setEdges]
  );

  // ── Save workflow ────────────────────────────────────────────────────

  const saveWorkflow = useCallback(async (silent = false) => {
    if (!scope.workspaceId) return;

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
      const response = await authenticatedFetch(workflowDetailUrl(scope.workspaceId, workflowId ?? ''), {
        method: 'PATCH',
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
  }, [workflowId, scope.workspaceId]);

  // ── JSON editor ──────────────────────────────────────────────────────

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
    })) as Node<WorkflowCanvasNodeData>[];

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
        labelBgPadding: [6, 4] as [number, number],
        labelBgBorderRadius: 4,
      } : {}),
    })) as Edge<WorkflowCanvasEdgeData>[];

    try {
      if (!scope.workspaceId || !workflowId) return;
      const response = await authenticatedFetch(workflowDetailUrl(scope.workspaceId, workflowId), {
        method: 'PATCH',
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
      toast.error('Network error -- see console');
    }
  }, [setNodes, setEdges, workflowId, scope.workspaceId, workflowVariables, updateVariable]);

  // ── Auto-save ────────────────────────────────────────────────────────

  useAutoSave({
    workflowId,
    autoSaveEnabled: autoSaveEnabled && !isRunning && !isSwaggerRefreshing,
    isHydrated: isWorkflowHydratedRef.current,
    nodes,
    edges,
    workflowVariables,
    saveWorkflow,
  });

  // ── Minimap & visual config ─────────────────────────────────────────

  const getNodeColor = useCallback((n: Node<WorkflowCanvasNodeData>) => {
    if (n.data?.executionStatus === 'running') return 'var(--aw-status-running)';
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

  const getNodeStrokeColor = useCallback((n: Node<WorkflowCanvasNodeData>) => {
    if (n.data?.executionStatus === 'error') return 'var(--aw-status-error)';
    return 'var(--aw-border)';
  }, []);

  const rfInstanceRef = useRef<Parameters<NonNullable<Parameters<typeof ReactFlow>[0]['onInit']>>[0] | null>(null);

  const handleInit = useCallback<NonNullable<Parameters<typeof ReactFlow>[0]['onInit']>>(
    (instance) => {
      rfInstanceRef.current = instance;
      (reactFlowInstanceRef as React.MutableRefObject<unknown>).current = instance;
    },
    [],
  );

  return (
    <main className="w-full h-full min-h-0 relative overflow-hidden bg-surface dark:bg-surface-dark text-text-primary dark:text-text-primary-dark transition-colors duration-300" aria-label="Workflow canvas">
      <div className="absolute inset-0 opacity-[0.05] dark:opacity-[0.07] bg-[linear-gradient(currentColor_1px,transparent_1px),linear-gradient(90deg,currentColor_1px,transparent_1px)] bg-[size:32px_32px] text-text-primary dark:text-text-primary-dark pointer-events-none" aria-hidden="true" />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.04] dark:opacity-[0.07] pointer-events-none mix-blend-multiply dark:mix-blend-screen"
        style={{ backgroundImage: NOISE_DATA_URI, backgroundSize: '240px 240px' }}
      />
      <ReactFlow
        className="relative z-10 bg-transparent"
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
        onInit={handleInit}
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
          gap={16}
          size={0.8}
          color="var(--aw-border)"
        />

        <Controls
          position="bottom-left"
          fitViewOptions={fitViewOptions}
          showInteractive={false}
        />

        <Panel position="bottom-right" style={{ bottom: 10, right: 10 }}>
          <MiniMap
            nodeColor={getNodeColor}
            nodeStrokeColor={getNodeStrokeColor}
            nodeStrokeWidth={1}
            maskColor={darkMode ? 'color-mix(in srgb, var(--aw-surface) 64%, transparent)' : 'color-mix(in srgb, var(--aw-text-primary) 5%, transparent)'}
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
          if (!isWorkflowHydratedRef.current) {
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
          setSelectedEnvironmentByWorkflow((prev) => ({ ...prev, [workflowId ?? '']: processed }));
          if (processed) {
            localStorage.setItem(`selectedEnvironment_${workflowId}`, processed);
            localStorage.setItem('defaultEnvironment', processed);
          } else {
            localStorage.removeItem(`selectedEnvironment_${workflowId}`);
          }
          toast.success(`Environment: ${envName}`);
        }}
        workflowId={workflowId ?? ''}
      />

      <AddNodesPanel isModalOpen={!!modalNode} showVariablesPanel={showVariablesPanel} onShowVariablesPanel={onShowVariablesPanel} />

      {modalNode && (
        <NodeModal
          key={modalNode.id}
          open={true}
          node={{
            ...modalNode,
            type: modalNode.type as 'http-request' | 'assertion' | 'delay' | 'merge' | 'start' | 'end',
            data: {
              ...modalNode.data,
              label: String(modalNode.data.label || ''),
              config: (modalNode.data.config as Record<string, unknown>) || {},
            },
          }}
          onClose={() => setModalNode(null)}
          onSave={(node) => handleModalSave(node as Node<WorkflowCanvasNodeData>)}
        />
      )}

      {showHistory && (
        <HistoryModal
          workflowId={workflowId ?? ''}
          workspaceId={scope.workspaceId ?? ''}
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

      {showJsonEditor && (
        <WorkflowJsonEditor
          open={true}
          workflowJson={workflowJsonMemo as unknown as Record<string, unknown>}
          onApply={handleJsonApply}
          onClose={() => {
            setShowJsonEditor(false);
          }}
        />
      )}

    </main>
  );
}

export default WorkflowCanvas;
