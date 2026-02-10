import React, { useState, useCallback, useRef, useEffect, useContext } from 'react';
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
import { toast } from 'sonner';
import { CanvasToolbar } from './organisms';
import useTabStore from '../stores/TabStore';
import useCanvasStore from '../stores/CanvasStore';
import useSidebarStore from '../stores/SidebarStore';
import useAutoSave from '../hooks/useAutoSave';
import useCanvasDrop from '../hooks/useCanvasDrop';
import useWorkflowPolling from '../hooks/useWorkflowPolling';
import API_BASE_URL from '../utils/api';

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
  console.log('WorkflowCanvas rendered with:', { workflowId, workflow });
  
  // Get global state from context
  const context = useContext(AppContext);
  console.log('WorkflowCanvas context:', context);
  const { darkMode, autoSaveEnabled } = context || { darkMode: false, autoSaveEnabled: true };
  
  // Get workflow state from WorkflowContext (ONLY variables and settings)
  const {
    variables: workflowVariables,
    registerExtractors,
    deleteVariable: contextDeleteVariable,
    updateVariable,
    onVariablesDeletedRef,
  } = useWorkflow();
  
  // Use ReactFlow's built-in hooks for nodes and edges (local to WorkflowCanvas)
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  
  const [selectedNode, setSelectedNode] = useState(null);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const [modalNode, setModalNode] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showImportToNodes, setShowImportToNodes] = useState(false);
  const [showJsonEditor, setShowJsonEditor] = useState(false);
  const [environments, setEnvironments] = useState([]);
  
  // Initialize selectedEnvironment from localStorage if available
  // Also check global default if workflow-specific one doesn't exist
  const [selectedEnvironment, setSelectedEnvironment] = useState(() => {
    // First try workflow-specific setting
    const workflowSpecific = localStorage.getItem(`selectedEnvironment_${workflowId}`);
    if (workflowSpecific) {
      console.log('🔧 Loaded workflow-specific environment:', { workflowId, environmentId: workflowSpecific });
      return workflowSpecific;
    }
    
    // Fall back to global default environment
    const globalDefault = localStorage.getItem('defaultEnvironment');
    if (globalDefault) {
      console.log('🔧 Using global default environment:', { environmentId: globalDefault });
      return globalDefault;
    }
    
    console.log('🔧 No environment selected (initializing empty):', { workflowId });
    return null;
  });
  
  // Save selectedEnvironment to localStorage when it changes
  useEffect(() => {
    console.log('💾 selectedEnvironment changed:', selectedEnvironment);
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
    console.log('📤 Syncing extractors to context from nodes');
    const extractorsFromNodes = {};
    nodes.forEach(node => {
      if (node.type === 'http-request' && node.data?.config?.extractors) {
        Object.assign(extractorsFromNodes, node.data.config.extractors);
      }
    });
    console.log('  Extractors found:', extractorsFromNodes);
    registerExtractors(extractorsFromNodes);
  }, [nodes, registerExtractors]);

  // Handle variable deletions from VariablesPanel — clean up extractors in nodes
  // This replaces the old `window.addEventListener('variableDeleted', ...)` pattern.
  // WorkflowContext exposes a ref that we set here; VariablesPanel calls
  // `deleteVariablesWithCleanup()` which invokes this callback.
  useEffect(() => {
    onVariablesDeletedRef.current = (deletedVars) => {
      if (!deletedVars || deletedVars.length === 0) return;
      console.log('🗑️ Cleaning up extractors for deleted variables:', deletedVars);
      setNodes(currentNodes => currentNodes.map(node => {
        if (node.type === 'http-request' && node.data?.config?.extractors) {
          const updatedExtractors = { ...node.data.config.extractors };
          let modified = false;
          deletedVars.forEach(varName => {
            if (varName in updatedExtractors) {
              delete updatedExtractors[varName];
              modified = true;
              console.log(`    ✓ Removed extractor "${varName}" from node`);
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
        console.log('Fetched environments:', data);
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

  // React to workflow reload signals from CanvasStore (e.g., from CurlImport append)
  const reloadVersion = useCanvasStore((s) => s.reloadVersion);
  const reloadWorkflowId = useCanvasStore((s) => s.reloadWorkflowId);
  useEffect(() => {
    if (reloadVersion > 0 && reloadWorkflowId === workflowId) {
      console.log('Workflow updated externally, reloading...');
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
            console.log('Workflow reloaded successfully');
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
        console.log('Node copied to clipboard:', cloneData);
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

    // Update nodes with branch info
    setNodes(nds => nds.map(node => {
      const nodeUpdate = {
        ...node,
        data: {
          ...node.data,
          branchCount: branchCounts[node.id] || 0,
          incomingBranchCount: incomingCounts[node.id] || 0,
        }
      };
      
      // For merge nodes, add incoming branch details
      if (node.type === 'merge' && incomingEdges[node.id]) {
        nodeUpdate.data.incomingBranches = incomingEdges[node.id].map((edge, idx) => {
          const sourceNode = nds.find(n => n.id === edge.source);
          return {
            index: idx,
            nodeId: edge.source,
            label: sourceNode?.data?.label || edge.source,
            edgeLabel: edge.label || `Branch ${idx}`
          };
        });
      }
      
      return nodeUpdate;
    }));
  }, [edges, setNodes]);

  // Load workflow data when available
  React.useEffect(() => {
    if (workflow && workflow.nodes && workflow.edges) {
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
      
      // Note: workflow.variables are loaded via WorkflowContext initialWorkflow prop
    }
  }, [workflow]);

  const onConnect = useCallback(
    (params) => {
      setEdges((eds) => {
        // Detect if source is an assertion node — auto-label Pass/Fail edges
        const sourceNode = nodes.find(n => n.id === params.source);
        const isAssertionSource = sourceNode?.type === 'assertion';
        
        if (isAssertionSource && params.sourceHandle) {
          const isPass = params.sourceHandle === 'pass';
          const label = isPass ? 'Pass' : 'Fail';
          const color = isPass
            ? (darkMode ? '#4ade80' : '#16a34a')
            : (darkMode ? '#f87171' : '#dc2626');
          
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
              fill: darkMode ? '#1f2937' : '#ffffff',
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
          const sourceNode = nodes.find(n => n.id === params.source);
          const sourceLabel = sourceNode?.data?.label || sourceNode?.id || 'Node';
          
          // Multiple edges from same node - mark as parallel branches
          return eds.map(e => {
            if (e.source === params.source) {
              const branchIndex = parallelEdges.findIndex(pe => pe.id === e.id);
              return {
                ...e, 
                animated: true, 
                style: { 
                  stroke: darkMode ? '#a78bfa' : '#8b5cf6', 
                  strokeWidth: 2 
                },
                label: `Branch ${branchIndex}`,
                labelStyle: { 
                  fill: darkMode ? '#e9d5ff' : '#5b21b6', 
                  fontWeight: 600,
                  fontSize: 11
                },
                labelBgStyle: {
                  fill: darkMode ? '#1f2937' : '#ffffff',
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
              stroke: darkMode ? '#a78bfa' : '#8b5cf6', 
              strokeWidth: 2 
            },
            label: `Branch ${parallelEdges.length}`,
            labelStyle: { 
              fill: darkMode ? '#e9d5ff' : '#5b21b6', 
              fontWeight: 600,
              fontSize: 11
            },
            labelBgStyle: {
              fill: darkMode ? '#1f2937' : '#ffffff',
              fillOpacity: 0.95
            },
            labelBgPadding: [6, 4],
            labelBgBorderRadius: 4
          }]);
        }
        
        return addEdge({ ...params, type: 'custom' }, eds);
      });
    },
    [setEdges, darkMode, nodes]
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
    onNodesChange(filteredChanges);
  }, [onNodesChange]);

  const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node);
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
  const { onDrop, onDragOver } = useCanvasDrop({ reactFlowInstance, setNodes });

  // Save workflow; when `silent` is true do not show alerts (used for autosave)
  const saveWorkflow = useCallback(async (silent = false) => {
    const workflow = {
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
    };

    try {
      const response = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflow),
      });
      
      if (response.ok) {
        console.log('Workflow saved successfully');
        useTabStore.getState().markClean(workflowId);
      } else {
        console.error('Failed to save workflow');
      }
    } catch (error) {
      console.error('Save error:', error);
    }
  }, [nodes, edges, workflowId, workflowVariables]);

  // Build the JSON object shown in the JSON editor
  const getWorkflowJson = useCallback(() => {
    return {
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
    };
  }, [nodes, edges, workflowVariables]);

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
  }, [setNodes, setEdges, workflowId, workflowVariables, darkMode, updateVariable]);

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
    reactFlowInstance,
  });

  // --- Debounced auto-save via extracted hook ---
  useAutoSave({
    workflowId,
    autoSaveEnabled,
    nodes,
    edges,
    workflowVariables,
    saveWorkflow,
  });

  return (
    <div className="w-full h-full relative bg-gray-50 dark:bg-gray-900 transition-colors">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onInit={setReactFlowInstance}
        onDrop={onDrop}
        onDragOver={onDragOver}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: 'custom' }}
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
        
        {/* MiniMap — bottom-left above controls */}
        <Panel position="bottom-left" style={{ bottom: 60, left: 10 }}>
          <MiniMap 
            nodeColor={(n) => {
              if (n.type === 'start') return '#06b6d4';
              if (n.type === 'end') return '#ef4444';
              return '#64748b';
            }}
            maskColor={darkMode ? "rgba(0, 0, 0, 0.6)" : "rgba(0, 0, 0, 0.05)"}
            style={{ 
              backgroundColor: darkMode ? '#1f2937' : 'white',
              border: darkMode ? '2px solid #374151' : '2px solid #0e7490',
              borderRadius: '8px',
              width: 180,
              height: 120,
            }}
            zoomable 
            pannable 
          />
        </Panel>
      </ReactFlow>

      {/* Canvas Toolbar */}
      <CanvasToolbar
        onSave={() => saveWorkflow(false)}
        onHistory={() => setShowHistory(true)}
        onJsonEditor={() => setShowJsonEditor(true)}
        onImport={() => setShowImportToNodes(true)}
        onRun={runWorkflow}
        isRunning={isRunning}
        environments={environments}
        selectedEnvironment={selectedEnvironment}
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
        workflowJson={getWorkflowJson()}
        onApply={handleJsonApply}
        onClose={() => setShowJsonEditor(false)}
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
