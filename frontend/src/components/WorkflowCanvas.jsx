import React, { useState, useCallback, useRef, useEffect, useContext, useMemo } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Panel,
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

const nodeTypes = {
  'http-request': HTTPRequestNode,
  'assertion': AssertionNode,
  'delay': DelayNode,
  'start': StartNode,
  'end': EndNode,
  'merge': MergeNode,
};

const edgeTypes = {
  'custom': CustomEdge,
};

const initialNodes = [
  {
    id: 'start-1',
    type: 'start',
    position: { x: 250, y: 50 },
    data: { label: 'Start' },
  },
];

const WorkflowCanvas = ({ workflowId, workflow, isPanelOpen = false, showVariablesPanel = false, onShowVariablesPanel = () => {} }) => {
  // Get global state from context
  const context = useContext(AppContext);
  const { darkMode, autoSaveEnabled } = context || { darkMode: false, autoSaveEnabled: true };
  
  // Use ref to track darkMode for MiniMap callbacks (prevents infinite re-renders)
  const darkModeRef = useRef(darkMode);
  useEffect(() => {
    darkModeRef.current = darkMode;
  }, [darkMode]);
  
  // Get workflow state from WorkflowContext (ONLY variables and settings)
  const {
    variables: workflowVariables,
    registerExtractors,
    deleteVariable: contextDeleteVariable,
    updateVariable,
    onVariablesDeletedRef,
  } = useWorkflow();
  const { addImportedGroup, removeImportedGroup } = usePalette();
  
  // Use ReactFlow's built-in hooks for nodes and edges (local to WorkflowCanvas)
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Keep refs for frequently changing values to stabilize ReactFlow handlers
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
  
  const [selectedNode, setSelectedNode] = useState(null);
  const [isDraggingNode, setIsDraggingNode] = useState(false);
  const [isWorkflowHydrated, setIsWorkflowHydrated] = useState(false);
  const reactFlowInstanceRef = useRef(null);
  const [modalNode, setModalNode] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showImportToNodes, setShowImportToNodes] = useState(false);
  const [showJsonEditor, setShowJsonEditor] = useState(false);
  const [jsonEditorInitialValue, setJsonEditorInitialValue] = useState(null);
  const [environments, setEnvironments] = useState([]);
  const [isSwaggerRefreshing, setIsSwaggerRefreshing] = useState(false);
  const swaggerRefreshSignatureRef = useRef('');
  const swaggerRefreshRequestIdRef = useRef(0);
  const hydratedBaselineRef = useRef(null);
  const envSwaggerGroupId = `env-openapi-${workflowId}`;
  
  // Initialize selectedEnvironment from localStorage if available
  // Also check global default if workflow-specific one doesn't exist
  const [selectedEnvironment, setSelectedEnvironment] = useState(() => {
    // First try workflow-specific setting
    const workflowSpecific = localStorage.getItem(`selectedEnvironment_${workflowId}`);
    if (workflowSpecific) {
      return workflowSpecific;
    }

    // Fall back to workflow-level default environment from backend
    if (workflow?.environmentId) {
      return workflow.environmentId;
    }
    
    // Fall back to global default environment
    const globalDefault = localStorage.getItem('defaultEnvironment');
    if (globalDefault) {
      return globalDefault;
    }
    
    return null;
  });
  
  // Save selectedEnvironment to localStorage when it changes
  useEffect(() => {
    if (selectedEnvironment) {
      // Save workflow-specific setting
      localStorage.setItem(`selectedEnvironment_${workflowId}`, selectedEnvironment);
      // Also save as global default so new workflows use it
      localStorage.setItem('defaultEnvironment', selectedEnvironment);
    } else {
      localStorage.removeItem(`selectedEnvironment_${workflowId}`);
    }
  }, [selectedEnvironment, workflowId]);


  // Track newly duplicated node IDs to prevent auto-selection
  const newDuplicateNodeRef = useRef(null);

  // Sync extractors from nodes to context - ALWAYS send current state
  useEffect(() => {
    const extractorsFromNodes = {};
    nodes.forEach(node => {
      if (node.type === 'http-request' && node.data?.config?.extractors) {
        Object.assign(extractorsFromNodes, node.data.config.extractors);
      }
    });
    registerExtractors(extractorsFromNodes);
  }, [nodes, registerExtractors]);

  // Handle variable deletions from VariablesPanel — clean up extractors in nodes
  // This replaces the old `window.addEventListener('variableDeleted', ...)` pattern.
  // WorkflowContext exposes a ref that we set here; VariablesPanel calls
  // `deleteVariablesWithCleanup()` which invokes this callback.
  useEffect(() => {
    onVariablesDeletedRef.current = (deletedVars) => {
      if (!deletedVars || deletedVars.length === 0) return;
      setNodes(currentNodes => currentNodes.map(node => {
        if (node.type === 'http-request' && node.data?.config?.extractors) {
          const updatedExtractors = { ...node.data.config.extractors };
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

  // Fetch environments
  const fetchEnvironments = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/environments`);
      if (response.ok) {
        const data = await response.json();
        setEnvironments(data);
      }
    } catch (error) {
      console.error('Error fetching environments:', error);
    }
  }, []);

  useEffect(() => { fetchEnvironments(); }, [fetchEnvironments]);

  // React to environment version changes from SidebarStore
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
        const { schemaRefreshWarning, ...restData } = node.data;
        didChange = true;
        return {
          ...node,
          data: restData,
        };
      });
      return didChange ? nextNodes : currentNodes;
    });
  }, [setNodes]);

  const refreshSwaggerTemplates = useCallback(async ({ force = false, showSuccessToast = false } = {}) => {
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
          const errorBody = await response.json();
          detail = errorBody.detail || detail;
        } catch (_) {
          // Keep default error detail if response body is not JSON
        }
        throw new Error(detail);
      }

      const result = await response.json();
      if (requestId !== swaggerRefreshRequestIdRef.current) {
        return { skipped: true, reason: 'superseded' };
      }

      const apiNodes = result.nodes || [];
      const items = apiNodes.map((node) => ({
        label: node.label || node.config?.url || 'Request',
        url: node.config?.url || '',
        method: node.config?.method || 'GET',
        headers: node.config?.headers || '',
        body: node.config?.body || '',
        queryParams: node.config?.queryParams || '',
        pathVariables: node.config?.pathVariables || '',
        cookies: node.config?.cookies || '',
        timeout: node.config?.timeout || 30,
        openapiMeta: node.config?.openapiMeta || null,
      }));

      addImportedGroup({
        title: `Swagger: ${selectedEnvObject?.name || 'Environment'}`,
        id: envSwaggerGroupId,
        items,
      });

      const latestFingerprintSet = new Set();
      const latestMethodPathSet = new Set();
      const latestMethodsByPath = new Map();
      const latestByOperationId = new Map();

      apiNodes.forEach((apiNode) => {
        const meta = apiNode?.config?.openapiMeta;
        if (!meta || meta.source !== 'openapi') return;

        const method = (meta.method || '').toUpperCase();
        const path = meta.path || '';
        const fingerprint = meta.fingerprint || '';
        const operationId = (meta.operationId || '').trim();

        if (fingerprint) latestFingerprintSet.add(fingerprint);
        if (method && path) latestMethodPathSet.add(`${method}|${path}`);

        if (path && method) {
          if (!latestMethodsByPath.has(path)) {
            latestMethodsByPath.set(path, new Set());
          }
          latestMethodsByPath.get(path).add(method);
        }

        if (operationId) {
          latestByOperationId.set(operationId, meta);
        }
      });

      setNodes((currentNodes) => {
        let didChange = false;
        const nextNodes = currentNodes.map((node) => {
          if (node.type !== 'http-request') {
            return node;
          }

          const existingWarning = node.data?.schemaRefreshWarning;
          const nodeMeta = node.data?.config?.openapiMeta;

          if (!nodeMeta || nodeMeta.source !== 'openapi') {
            if (!existingWarning) {
              return node;
            }
            didChange = true;
            const { schemaRefreshWarning, ...restData } = node.data;
            return { ...node, data: restData };
          }

          const metaMethod = (nodeMeta.method || '').toUpperCase();
          const metaPath = nodeMeta.path || '';
          const metaFingerprint = nodeMeta.fingerprint || '';
          const metaOperationId = (nodeMeta.operationId || '').trim();
          const methodPathKey = metaMethod && metaPath ? `${metaMethod}|${metaPath}` : '';

          let warningText = null;

          if (metaFingerprint && latestFingerprintSet.has(metaFingerprint)) {
            warningText = null;
          } else if (methodPathKey && latestMethodPathSet.has(methodPathKey)) {
            warningText = null;
          } else if (metaOperationId && latestByOperationId.has(metaOperationId)) {
            const latestMeta = latestByOperationId.get(metaOperationId);
            warningText = `Endpoint changed in Swagger docs (${metaMethod} ${metaPath} -> ${latestMeta.method} ${latestMeta.path}).`;
          } else if (metaPath && latestMethodsByPath.has(metaPath)) {
            const availableMethods = Array.from(latestMethodsByPath.get(metaPath)).join(', ');
            warningText = `Method mismatch for ${metaPath}. Available method(s): ${availableMethods}.`;
          } else {
            warningText = `Endpoint no longer found in Swagger docs (${metaMethod} ${metaPath}).`;
          }

          if (!warningText) {
            if (!existingWarning) {
              return node;
            }
            didChange = true;
            const { schemaRefreshWarning, ...restData } = node.data;
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
        const endpointCount = items.length;
        toast.success(`Swagger refreshed: ${endpointCount} endpoint${endpointCount === 1 ? '' : 's'}.`);
      }

      return { endpointCount: items.length };
    } catch (error) {
      if (requestId === swaggerRefreshRequestIdRef.current) {
        removeImportedGroup(envSwaggerGroupId);
      }
      toast.error(error.message || 'Failed to refresh nodes from environment Swagger URL');
      return { error: error.message || 'Failed to refresh nodes from environment Swagger URL' };
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

  // Ensure environment Swagger group is cleaned up when workflow unmounts/switches
  useEffect(() => {
    return () => {
      swaggerRefreshRequestIdRef.current += 1;
      removeImportedGroup(envSwaggerGroupId);
    };
  }, [envSwaggerGroupId, removeImportedGroup]);

  // Auto-refresh Add Nodes from selected environment Swagger/OpenAPI URL
  useEffect(() => {
    refreshSwaggerTemplates();
  }, [refreshSwaggerTemplates]);

  const handleManualSwaggerRefresh = useCallback(() => {
    refreshSwaggerTemplates({ force: true, showSuccessToast: true });
  }, [refreshSwaggerTemplates]);

  // React to workflow reload signals from CanvasStore (e.g., from CurlImport append)
  const reloadVersion = useCanvasStore((s) => s.reloadVersion);
  const reloadWorkflowId = useCanvasStore((s) => s.reloadWorkflowId);
  useEffect(() => {
    if (reloadVersion > 0 && reloadWorkflowId === workflowId) {

      (async () => {
        try {
          const response = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}`);
          if (response.ok) {
            const data = await response.json();
            const newNodes = (data.nodes || []).map(node => ({
              id: node.nodeId,
              type: node.type,
              position: node.position,
              data: {
                config: node.config,
                label: node.label,
              },
            }));
            const newEdges = (data.edges || []).map(edge => ({
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
                    ? (darkMode ? '#4ade80' : '#16a34a')
                    : (darkMode ? '#f87171' : '#dc2626'),
                  strokeWidth: 2,
                },
                labelStyle: {
                  fill: edge.sourceHandle === 'pass'
                    ? (darkMode ? '#4ade80' : '#16a34a')
                    : (darkMode ? '#f87171' : '#dc2626'),
                  fontWeight: 700,
                  fontSize: 11,
                },
                labelBgStyle: {
                  fill: darkMode ? '#1f2937' : '#ffffff',
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
  }, [reloadVersion, reloadWorkflowId, workflowId, setNodes, setEdges, darkMode]);

  // ---------- Node actions via CanvasStore (replaces window events) ----------
  // React to pendingAction from CanvasStore (BaseNode menu triggers these)
  const pendingAction = useCanvasStore((s) => s.pendingAction);
  useEffect(() => {
    if (!pendingAction) return;
    const { type, nodeId } = pendingAction;

    if (type === 'duplicate' && nodeId) {
      const nodeToClone = nodes.find((n) => n.id === nodeId);
      if (nodeToClone) {
        const newNode = {
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
        useCanvasStore.getState().setClipboardNode(cloneData);
      }
    } else if (type === 'paste') {
      const cloneData = sessionStorage.getItem('copiedNode');
      if (!cloneData) {
        toast.error('No node in clipboard');
      } else {
        try {
          const { type: nodeType, data } = JSON.parse(cloneData);
          let newPosition = { x: 400, y: 300 };
          if (selectedNode) {
            newPosition = { x: selectedNode.position.x + 200, y: selectedNode.position.y + 150 };
          } else if (nodes.length > 0) {
            const lastNode = nodes[nodes.length - 1];
            newPosition = { x: lastNode.position.x + 150, y: lastNode.position.y + 150 };
          }
          setNodes((nds) => [...nds, { id: `node-${Date.now()}`, type: nodeType, position: newPosition, data }]);
          toast.success('Node pasted successfully');
        } catch (err) {
          toast.error('Error pasting node: ' + err.message);
        }
      }
    }
    useCanvasStore.getState().clearPendingAction();
  }, [pendingAction, nodes, setNodes, selectedNode]);

  // ---------- Keyboard shortcuts (Ctrl+C / Ctrl+V) ----------
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isInputFocused = document.activeElement?.tagName === 'INPUT' || 
                             document.activeElement?.tagName === 'TEXTAREA' ||
                             document.activeElement?.contentEditable === 'true';
      if (isInputFocused) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (selectedNode) {
          e.preventDefault();
          useCanvasStore.getState().copyNode(selectedNode.id);
          toast.success('Node copied to clipboard');
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        useCanvasStore.getState().pasteNode();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNode]);

  // Detect parallel branches and update node data with branch counts
  useEffect(() => {
    // Count outgoing edges per node
    const branchCounts = {};
    edges.forEach(edge => {
      branchCounts[edge.source] = (branchCounts[edge.source] || 0) + 1;
    });

    // Count incoming edges per node (for merge detection)
    const incomingCounts = {};
    const incomingEdges = {}; // Store actual incoming edges for merge nodes
    edges.forEach(edge => {
      incomingCounts[edge.target] = (incomingCounts[edge.target] || 0) + 1;
      if (!incomingEdges[edge.target]) {
        incomingEdges[edge.target] = [];
      }
      incomingEdges[edge.target].push(edge);
    });

    const branchesEqual = (left, right) => {
      if (left === right) return true;
      if (!left || !right) return false;
      if (left.length !== right.length) return false;
      for (let i = 0; i < left.length; i += 1) {
        const l = left[i];
        const r = right[i];
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

    // Update nodes with branch info
    setNodes(nds => {
      let didChange = false;
      const nextNodes = nds.map(node => {
        const nextBranchCount = branchCounts[node.id] || 0;
        const nextIncomingBranchCount = incomingCounts[node.id] || 0;
        const prevData = node.data || {};

        let nextIncomingBranches = prevData.incomingBranches;
        let incomingBranchesChanged = false;

        if (node.type === 'merge' && incomingEdges[node.id]) {
          nextIncomingBranches = incomingEdges[node.id].map((edge, idx) => {
            const sourceNode = nds.find(n => n.id === edge.source);
            return {
              index: idx,
              nodeId: edge.source,
              label: sourceNode?.data?.label || edge.source,
              edgeLabel: edge.label || `Branch ${idx}`
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

  // Load workflow data when available
  React.useEffect(() => {
    if (!workflow || !Array.isArray(workflow.nodes) || !Array.isArray(workflow.edges)) {
      setIsWorkflowHydrated(false);
      return;
    }

    const loadedNodes = workflow.nodes.map(node => ({
      id: node.nodeId,
      type: node.type,
      position: node.position,
      data: {
        label: node.label,
        config: node.config || {},
      },
    }));
    
    const loadedEdges = workflow.edges.map(edge => ({
      id: edge.edgeId,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || null,
      targetHandle: edge.targetHandle || null,
      label: edge.label,
      type: 'custom',
      // Restore assertion edge styling on load
      ...(edge.sourceHandle === 'pass' || edge.sourceHandle === 'fail' ? {
        animated: true,
        style: {
          stroke: edge.sourceHandle === 'pass'
            ? (darkMode ? '#4ade80' : '#16a34a')
            : (darkMode ? '#f87171' : '#dc2626'),
          strokeWidth: 2,
        },
        labelStyle: {
          fill: edge.sourceHandle === 'pass'
            ? (darkMode ? '#4ade80' : '#16a34a')
            : (darkMode ? '#f87171' : '#dc2626'),
          fontWeight: 700,
          fontSize: 11,
        },
        labelBgStyle: {
          fill: darkMode ? '#1f2937' : '#ffffff',
          fillOpacity: 0.95,
        },
        labelBgPadding: [6, 4],
        labelBgBorderRadius: 4,
      } : {}),
    }));
    
    setNodes(loadedNodes);
    setEdges(loadedEdges);
    setIsWorkflowHydrated(true);
    hydratedBaselineRef.current = {
      nodeCount: loadedNodes.length,
      edgeCount: loadedEdges.length,
    };
    
    // Note: workflow.variables are loaded via WorkflowContext initialWorkflow prop
  }, [workflow, darkMode, setNodes, setEdges]);

  const onConnect = useCallback(
    (params) => {
      setEdges((eds) => {
        const currentNodes = nodesRef.current;
        const isDark = darkModeRef.current;

        // Detect if source is an assertion node — auto-label Pass/Fail edges
        const sourceNode = currentNodes.find(n => n.id === params.source);
        const isAssertionSource = sourceNode?.type === 'assertion';
        
        if (isAssertionSource && params.sourceHandle) {
          const isPass = params.sourceHandle === 'pass';
          const label = isPass ? 'Pass' : 'Fail';
          const color = isPass
            ? (isDark ? '#4ade80' : '#16a34a')
            : (isDark ? '#f87171' : '#dc2626');
          
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
              fill: isDark ? '#1f2937' : '#ffffff',
              fillOpacity: 0.95,
            },
            labelBgPadding: [6, 4],
            labelBgBorderRadius: 4,
          };
          return [...eds, newEdge];
        }
        
        const newEdge = addEdge({ ...params, type: 'custom' }, eds)[eds.length];
        
        // Check if this creates parallel branches (multiple edges from same source)
        const parallelEdges = eds.filter(e => e.source === params.source);
        
        if (parallelEdges.length > 0) {
          // Get source node label for better edge labels
          const sourceNode = currentNodes.find(n => n.id === params.source);
          const sourceLabel = sourceNode?.data?.label || sourceNode?.id || 'Node';
          
          // Multiple edges from same node - mark as parallel branches
          return eds.map(e => {
            if (e.source === params.source) {
              const branchIndex = parallelEdges.findIndex(pe => pe.id === e.id);
              return {
                ...e, 
                animated: true, 
                style: { 
                  stroke: isDark ? '#a78bfa' : '#8b5cf6', 
                  strokeWidth: 2 
                },
                label: `Branch ${branchIndex}`,
                labelStyle: { 
                  fill: isDark ? '#e9d5ff' : '#5b21b6', 
                  fontWeight: 600,
                  fontSize: 11
                },
                labelBgStyle: {
                  fill: isDark ? '#1f2937' : '#ffffff',
                  fillOpacity: 0.95
                },
                labelBgPadding: [6, 4],
                labelBgBorderRadius: 4
              };
            }
            return e;
          }).concat([{
            ...newEdge,
            type: 'custom',
            animated: true,
            style: { 
              stroke: isDark ? '#a78bfa' : '#8b5cf6', 
              strokeWidth: 2 
            },
            label: `Branch ${parallelEdges.length}`,
            labelStyle: { 
              fill: isDark ? '#e9d5ff' : '#5b21b6', 
              fontWeight: 600,
              fontSize: 11
            },
            labelBgStyle: {
              fill: isDark ? '#1f2937' : '#ffffff',
              fillOpacity: 0.95
            },
            labelBgPadding: [6, 4],
            labelBgBorderRadius: 4
          }]);
        }
        
        return addEdge({ ...params, type: 'custom' }, eds);
      });
    },
    [setEdges]
  );

  // Wrap onNodesChange to prevent new duplicate nodes from being auto-selected
  const handleNodesChange = useCallback((changes) => {
    // Filter out selection changes for newly duplicated nodes
    const filteredChanges = changes.filter((change) => {
      if (change.type === 'select' && newDuplicateNodeRef.current === change.id) {
        return false; // Ignore selection of newly duplicated node
      }
      return true;
    });
    onNodesChangeRef.current(filteredChanges);
  }, []);

  const handleEdgesChange = useCallback((changes) => {
    onEdgesChangeRef.current(changes);
  }, []);

  const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node);
  }, []);

  const onNodeDragStart = useCallback(() => {
    setIsDraggingNode(true);
  }, []);

  const onNodeDragStop = useCallback(() => {
    setIsDraggingNode(false);
  }, []);

  const onNodeDoubleClick = useCallback((event, node) => {
    // Don't open modal for start/end nodes
    if (node.type !== 'start' && node.type !== 'end') {
      setModalNode(node);
    }
  }, []);

  const handleModalSave = useCallback((updatedNode) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === updatedNode.id ? updatedNode : n))
    );
  }, [setNodes]);

  const handleDuplicateNode = useCallback((nodeId) => {
    let newNodeId = null;
    setNodes((nds) => {
      const nodeToClone = nds.find((n) => n.id === nodeId);
      if (!nodeToClone) return nds;

      // Determine the parent node ID (either the node itself or its parent)
      const parentNodeId = nodeToClone.data?.parentNodeId || nodeId;

      // Count how many nodes have this parent (including the parent itself)
      const siblingCount = nds.filter((n) => 
        (n.data?.parentNodeId === parentNodeId) || n.id === parentNodeId
      ).length;

      // Create a new node with same config but different ID
      // Deep copy the entire data object to avoid shared references
      newNodeId = `${nodeId}-dup-${Date.now()}`;
      const newNode = {
        ...nodeToClone,
        id: newNodeId,
        position: {
          x: nodeToClone.position.x + (siblingCount * 150), // Cascade horizontally
          y: nodeToClone.position.y + (siblingCount * 150), // Cascade vertically
        },
        data: {
          ...JSON.parse(JSON.stringify(nodeToClone.data)), // Deep copy entire data object
          parentNodeId: parentNodeId, // Track the original node
        },
        selected: false, // Ensure new node is NOT selected
      };

      return [...nds, newNode];
    });
    
    // Mark this node so onNodesChange can ignore selection events for it
    if (newNodeId) {
      newDuplicateNodeRef.current = newNodeId;
      setTimeout(() => {
        newDuplicateNodeRef.current = null;
      }, 100);
    }
  }, []);


  // --- Drag-and-drop via extracted hook ---
  const { onDrop, onDragOver } = useCanvasDrop({ reactFlowInstanceRef, setNodes });

  // Save workflow; when `silent` is true do not show alerts (used for autosave)
  const saveWorkflow = useCallback(async (silent = false) => {
    const workflowPayload = {
      nodes: nodesRef.current.map(node => ({
        nodeId: node.id,
        type: node.type,
        label: node.data.label,
        position: node.position,
        config: node.data.config || {},
      })),
      edges: edgesRef.current.map(edge => ({
        edgeId: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle || null,
        targetHandle: edge.targetHandle || null,
        label: edge.label || null,
      })),
      variables: workflowVariablesRef.current,
    };

    const nodeCount = workflowPayload.nodes.length;
    const edgeCount = workflowPayload.edges.length;
    const variableCount = Object.keys(workflowPayload.variables || {}).length;

    console.info('[workflow-save]', {
      workflowId,
      silent,
      nodeCount,
      edgeCount,
      variableCount,
    });

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
        useTabStore.getState().markClean(workflowId);
      } else {
        console.error('Failed to save workflow');
      }
    } catch (error) {
      console.error('Save error:', error);
    }
  }, [workflowId, workflow]);

  // Build JSON for the JSON editor from live state (not stale refs)
  const workflowJsonMemo = useMemo(() => ({
    nodes: nodes.map(node => ({
      nodeId: node.id,
      type: node.type,
      label: node.data.label,
      position: node.position,
      config: node.data.config || {},
    })),
    edges: edges.map(edge => ({
      edgeId: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || null,
      targetHandle: edge.targetHandle || null,
      label: edge.label || null,
    })),
    variables: workflowVariables,
  }), [nodes, edges, workflowVariables]);

  // Apply changes from the JSON editor back to the canvas
  const handleJsonApply = useCallback(async (parsed) => {
    // Rebuild ReactFlow nodes from the JSON
    const newNodes = (parsed.nodes || []).map(node => ({
      id: node.nodeId,
      type: node.type,
      position: node.position,
      data: {
        label: node.label,
        config: node.config || {},
      },
    }));

    const newEdges = (parsed.edges || []).map(edge => ({
      id: edge.edgeId,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || null,
      targetHandle: edge.targetHandle || null,
      label: edge.label,
      type: 'custom',
      // Restore assertion edge styling
      ...(edge.sourceHandle === 'pass' || edge.sourceHandle === 'fail' ? {
        animated: true,
        style: {
          stroke: edge.sourceHandle === 'pass'
            ? (darkMode ? '#4ade80' : '#16a34a')
            : (darkMode ? '#f87171' : '#dc2626'),
          strokeWidth: 2,
        },
        labelStyle: {
          fill: edge.sourceHandle === 'pass'
            ? (darkMode ? '#4ade80' : '#16a34a')
            : (darkMode ? '#f87171' : '#dc2626'),
          fontWeight: 700,
          fontSize: 11,
        },
        labelBgStyle: {
          fill: darkMode ? '#1f2937' : '#ffffff',
          fillOpacity: 0.95,
        },
        labelBgPadding: [6, 4],
        labelBgBorderRadius: 4,
      } : {}),
    }));

    // Save to backend FIRST — only update canvas if save succeeds
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
        // Save succeeded — apply to canvas and close editor
        setNodes(newNodes);
        setEdges(newEdges);

        if (parsed.variables && typeof parsed.variables === 'object') {
          Object.entries(parsed.variables).forEach(([k, v]) => updateVariable(k, v));
        }

        setShowJsonEditor(false);
        toast.success('Workflow updated from JSON editor');
      } else {
        // Parse validation errors from the backend
        try {
          const errBody = await response.json();
          if (errBody.detail && Array.isArray(errBody.detail)) {
            const messages = errBody.detail.map(d => {
              const loc = d.loc ? d.loc.slice(1).join(' → ') : '';
              return `${loc}: ${d.msg}`;
            });
            toast.error(messages.join('\n'));
          } else {
            toast.error(errBody.detail || `Save failed (${response.status})`);
          }
        } catch {
          toast.error(`Save failed with status ${response.status}`);
        }
      }
    } catch (err) {
      console.error('JSON editor save error:', err);
      toast.error('Network error — see console');
    }
  }, [setNodes, setEdges, workflowId, workflowVariables, darkMode, updateVariable, workflow]);

  // --- Workflow run + adaptive polling via extracted hook ---
  const {
    isRunning,
    currentRunId,
    runWorkflow,
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

  // --- Debounced auto-save via extracted hook ---
  useAutoSave({
    workflowId,
    autoSaveEnabled: autoSaveEnabled && !isDraggingNode && !isRunning,
    isHydrated: isWorkflowHydrated,
    nodes,
    edges,
    workflowVariables,
    saveWorkflow,
  });

  // --- Memoized MiniMap callbacks to prevent infinite re-renders ---
  const getNodeColor = useCallback((n) => {
    const isDark = darkModeRef.current;
    // Execution status colors take precedence
    if (n.data?.executionStatus === 'running') return isDark ? '#3b82f6' : '#2563eb';
    if (n.data?.executionStatus === 'success') return isDark ? '#22c55e' : '#16a34a';
    if (n.data?.executionStatus === 'error') return isDark ? '#ef4444' : '#dc2626';

    // Node type colors
    if (n.type === 'start') return isDark ? '#06b6d4' : '#0891b2';
    if (n.type === 'end') return isDark ? '#f87171' : '#dc2626';
    if (n.type === 'httpRequest') return isDark ? '#818cf8' : '#6366f1';
    if (n.type === 'assertion') return isDark ? '#4ade80' : '#22c55e';
    if (n.type === 'delay') return isDark ? '#fbbf24' : '#f59e0b';
    if (n.type === 'merge') return isDark ? '#a78bfa' : '#8b5cf6';

    return isDark ? '#64748b' : '#94a3b8';
  }, []);

  const getNodeStrokeColor = useCallback((n) => {
    const isDark = darkModeRef.current;
    if (n.data?.executionStatus === 'error') return isDark ? '#dc2626' : '#b91c1c';
    return isDark ? '#374151' : '#cbd5e1';
  }, []);

  const miniMapStyle = useMemo(() => ({
    backgroundColor: darkMode ? '#1f2937' : 'white',
    border: darkMode ? '2px solid #374151' : '2px solid #0e7490',
    borderRadius: '8px',
    width: 220,
    height: 150,
  }), [darkMode]);

  const miniMapMaskColor = useMemo(
    () => (darkMode ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.05)'),
    [darkMode],
  );

  const defaultEdgeOptions = useMemo(
    () => ({ type: 'custom', animated: true }),
    [],
  );

  const reactFlowStyle = useMemo(
    () => ({ width: '100%', height: '100%' }),
    [],
  );

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
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={onNodeDoubleClick}
        onInit={(instance) => {
          reactFlowInstanceRef.current = instance;
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        deleteKeyCode="Delete"
        multiSelectionKeyCode="Control"
      >
        <Background 
          variant="dots" 
          gap={12} 
          size={1} 
          color={darkMode ? "#444" : "#aaa"}
        />
        
        {/* Zoom controls — bottom-left */}
        <Controls 
          position="bottom-left"
          className="border border-border-default dark:border-border-default-dark shadow-md rounded-lg"
        />
        
        {/* MiniMap — bottom-right */}
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

      {/* Canvas Toolbar */}
      <CanvasToolbar
        onSave={() => saveWorkflow(false)}
        onHistory={() => setShowHistory(true)}
        onJsonEditor={() => {
          if (!isWorkflowHydrated) {
            toast.info('Workflow is still loading. Try JSON again in a moment.');
            return;
          }
          setJsonEditorInitialValue(workflowJsonMemo);
          setShowJsonEditor(true);
        }}
        onImport={() => setShowImportToNodes(true)}
        onRun={runWorkflow}
        isRunning={isRunning}
        environments={environments}
        selectedEnvironment={selectedEnvironment}
        onRefreshSwagger={handleManualSwaggerRefresh}
        isSwaggerRefreshing={isSwaggerRefreshing}
        onEnvironmentChange={(val) => {
          const processed = (val && val.trim()) ? val.trim() : null;
          const selectedEnv = environments.find(e => e.environmentId === processed);
          const envName = selectedEnv ? selectedEnv.name : 'No Environment';
          setSelectedEnvironment(processed);
          toast.success(`Environment: ${envName}`);
        }}
        workflowId={workflowId}
      />

      {/* Add Nodes Panel - OUTSIDE ReactFlow */}
      <AddNodesPanel isModalOpen={!!modalNode} isPanelOpen={isPanelOpen} showVariablesPanel={showVariablesPanel} onShowVariablesPanel={onShowVariablesPanel} />

      {/* Node Modal */}
      <NodeModal
        open={!!modalNode}
        node={modalNode || { data: {}, type: 'start' }}
        onClose={() => setModalNode(null)}
        onSave={handleModalSave}
      />

      {/* History Modal */}
      {showHistory && (
        <HistoryModal
          workflowId={workflowId}
          onClose={() => setShowHistory(false)}
          onSelectRun={loadHistoricalRun}
        />
      )}

      {/* Import to Nodes Panel */}
      {showImportToNodes && (
        <ImportToNodesPanel
          isOpen={showImportToNodes}
          onClose={() => setShowImportToNodes(false)}
          workflowId={workflowId}
        />
      )}

      {/* JSON Workflow Editor */}
      <WorkflowJsonEditor
        open={showJsonEditor}
        workflowJson={showJsonEditor ? jsonEditorInitialValue : null}
        onApply={handleJsonApply}
        onClose={() => {
          setShowJsonEditor(false);
          setJsonEditorInitialValue(null);
        }}
      />

      {/* Secrets Prompt — shown when run is triggered and environment has unfilled secrets */}
      <SecretsPrompt
        open={showSecretsPrompt && !!environments.find(e => e.environmentId === (selectedEnvironment && selectedEnvironment.trim() ? selectedEnvironment.trim() : null))}
        environment={environments.find(e => e.environmentId === (selectedEnvironment && selectedEnvironment.trim() ? selectedEnvironment.trim() : null)) || {}}
        onClose={() => { setShowSecretsPrompt(false); pendingRunRef.current = false; }}
        onSecretsProvided={handleSecretsProvided}
      />
      
    </div>
  );
};

export default WorkflowCanvas;
