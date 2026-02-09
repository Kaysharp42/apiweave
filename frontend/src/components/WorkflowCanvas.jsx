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
import ButtonSelect from './ButtonSelect';
import { Save, History, Play, Code, Upload } from 'lucide-react';
import useTabStore from '../stores/TabStore';
import API_BASE_URL from '../utils/api';

// Update node statuses - always update to ensure fresh data on each run
const selectiveNodeUpdate = (currentNodes, nodeStatuses) => {
  return currentNodes.map((node) => {
    const nodeStatus = nodeStatuses[node.id];
    if (!nodeStatus) return node;
    
    // Always update to ensure fresh results on each run
    // Extract assertion-specific info from result if it's an assertion node
    let assertionStats = null;
    if (node.type === 'assertion' && nodeStatus.result) {
      const result = nodeStatus.result;
      if (result.passedCount !== undefined || result.failedCount !== undefined) {
        assertionStats = {
          passedCount: result.passedCount || 0,
          failedCount: result.failedCount || 0,
          totalCount: result.totalCount || 0,
          passed: result.passed || [],
          failed: result.failed || []
        };
      }
    }
    
    return {
      ...node,
      data: {
        ...node.data,
        executionStatus: nodeStatus?.status,
        executionResult: nodeStatus?.result, // Full response with fresh data
        executionTimestamp: nodeStatus?.timestamp, // Track when result was generated
        assertionStats: assertionStats, // Extracted assertion statistics
      },
    };
  });
};

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
  const [showSecretsPrompt, setShowSecretsPrompt] = useState(false);
  const pendingRunRef = useRef(false);  // Flag to auto-run after secrets are provided
  const [environments, setEnvironments] = useState([]);
  const [environmentChangeNotification, setEnvironmentChangeNotification] = useState(null);
  
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

  // Auto-save timer reference
  const autoSaveTimerRef = useRef(null);
  
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

  // Listen for variable deletions from VariablesPanel and clean up extractors
  useEffect(() => {
    const handleVariableDelete = (event) => {
      if (event.detail.workflowId === workflowId) {
        const { deletedVars = [] } = event.detail;
        
        if (deletedVars.length > 0) {
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
                    config: {
                      ...node.data.config,
                      extractors: updatedExtractors
                    }
                  }
                };
              }
            }
            return node;
          }));
        }
      }
    };
    
    window.addEventListener('variableDeleted', handleVariableDelete);
    return () => window.removeEventListener('variableDeleted', handleVariableDelete);
  }, [workflowId, setNodes]);

  // Listen for extractor deletions from nodes and remove from variables
  useEffect(() => {
    const handleExtractorDeleted = (event) => {
      const { varName } = event.detail;
      console.log('🗑️ Extractor deleted from node, removing from variables:', varName);
      
      // Simply delete from context - the extractor sync will handle keeping them in sync
      // Actually, we don't need this - the registerExtractors will auto-update when node changes
    };
    
    window.addEventListener('extractorDeleted', handleExtractorDeleted);
    return () => window.removeEventListener('extractorDeleted', handleExtractorDeleted);
  }, []);

  // Fetch environments
  useEffect(() => {
    const fetchEnvironments = async () => {
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
    };
    
    fetchEnvironments();
    
    // Listen for environment changes
    const handleEnvironmentsChanged = () => {
      fetchEnvironments();
    };
    window.addEventListener('environmentsChanged', handleEnvironmentsChanged);
    
    return () => {
      window.removeEventListener('environmentsChanged', handleEnvironmentsChanged);
    };
  }, []);

  // Listen for workflow updates (e.g., from curl import append)
  useEffect(() => {
    const handleWorkflowUpdated = async (event) => {
      const { workflowId: updatedWorkflowId } = event.detail;
      if (updatedWorkflowId === workflowId) {
        console.log('Workflow updated, reloading...');
        // Reload the workflow from the server
        try {
          const response = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}`);
          if (response.ok) {
            const data = await response.json();
            // Update nodes and edges with new workflow data
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
      }
    };
    window.addEventListener('workflowUpdated', handleWorkflowUpdated);
    return () => {
      window.removeEventListener('workflowUpdated', handleWorkflowUpdated);
    };
  }, [workflowId, setNodes, setEdges]);

  // Listen for duplicate and copy node events from nodes
  useEffect(() => {
    const handleDuplicateNode = (event) => {
      const { nodeId } = event.detail;
      const nodeToClone = nodes.find((n) => n.id === nodeId);
      if (!nodeToClone) return;

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
    };

    const handleCopyNode = (event) => {
      const { nodeId } = event.detail;
      const nodeToClone = nodes.find((n) => n.id === nodeId);
      if (!nodeToClone) return;

      const cloneData = {
        type: nodeToClone.type,
        data: JSON.parse(JSON.stringify(nodeToClone.data)),
      };
      sessionStorage.setItem('copiedNode', JSON.stringify(cloneData));
      console.log('Node copied to clipboard:', cloneData);
    };

    const handlePasteNode = () => {
      const cloneData = sessionStorage.getItem('copiedNode');
      if (!cloneData) {
        toast.error('No node in clipboard');
        return;
      }

      try {
        const { type, data } = JSON.parse(cloneData);
        
        // Position new node relative to selected node, or use default
        let newPosition = { x: 400, y: 300 };
        if (selectedNode) {
          // Position offset to the right and down from selected node
          newPosition = {
            x: selectedNode.position.x + 200,
            y: selectedNode.position.y + 150,
          };
        } else if (nodes.length > 0) {
          // Fallback: position offset from last node
          const lastNode = nodes[nodes.length - 1];
          newPosition = {
            x: lastNode.position.x + 150,
            y: lastNode.position.y + 150,
          };
        }

        const newNode = {
          id: `node-${Date.now()}`,
          type,
          position: newPosition,
          data,
        };

        setNodes((nds) => [...nds, newNode]);
        toast.success('Node pasted successfully');
        console.log('Node pasted successfully');
      } catch (err) {
        toast.error('Error pasting node: ' + err.message);
        console.error('Error pasting node:', err);
      }
    };

    const handleKeyDown = (e) => {
      // Only handle keyboard shortcuts when a node is selected and we're not typing in an input
      const isInputFocused = document.activeElement?.tagName === 'INPUT' || 
                             document.activeElement?.tagName === 'TEXTAREA' ||
                             document.activeElement?.contentEditable === 'true';

      if (isInputFocused) return;

      // Ctrl+C (or Cmd+C on Mac) for copy
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (selectedNode) {
          e.preventDefault();
          handleCopyNode({ detail: { nodeId: selectedNode.id } });
          toast.success('Node copied to clipboard');
        }
      }

      // Ctrl+V (or Cmd+V on Mac) for paste
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        handlePasteNode();
      }
    };

    window.addEventListener('duplicateNode', handleDuplicateNode);
    window.addEventListener('copyNode', handleCopyNode);
    window.addEventListener('pasteNode', handlePasteNode);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('duplicateNode', handleDuplicateNode);
      window.removeEventListener('copyNode', handleCopyNode);
      window.removeEventListener('pasteNode', handlePasteNode);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [nodes, setNodes, selectedNode]);

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

  const handleCopyNode = useCallback((nodeId) => {
    const nodeToClone = nodes.find((n) => n.id === nodeId);
    if (!nodeToClone) return;

    // Store in clipboard (use sessionStorage as clipboard API might have issues)
    const cloneData = {
      type: nodeToClone.type,
      data: JSON.parse(JSON.stringify(nodeToClone.data)),
    };
    sessionStorage.setItem('copiedNode', JSON.stringify(cloneData));
    console.log('Node copied to clipboard:', cloneData);
  }, [nodes]);

  const handlePasteNode = useCallback(() => {
    const cloneData = sessionStorage.getItem('copiedNode');
    if (!cloneData) {
      console.warn('No node in clipboard');
      return;
    }

    try {
      const { type, data } = JSON.parse(cloneData);
      setNodes((nds) => {
        // Find a suitable position (offset from center or last node)
        let newPosition = { x: 400, y: 300 };
        if (nds.length > 0) {
          const lastNode = nds[nds.length - 1];
          newPosition = {
            x: lastNode.position.x + 150,
            y: lastNode.position.y + 150,
          };
        }

        const newNode = {
          id: `node-${Date.now()}`,
          type,
          position: newPosition,
          data,
        };

        return [...nds, newNode];
      });
      console.log('Node pasted successfully');
    } catch (err) {
      console.error('Error pasting node:', err);
    }
  }, [setNodes]);

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const getDefaultConfig = (type) => {
    switch (type) {
      case 'http-request':
        return {
          method: 'GET',
          url: '',
          queryParams: '',
          pathVariables: '',
          headers: '',
          cookies: '',
          body: '',
          timeout: 30,
        };
      case 'assertion':
        return { assertions: [] };
      case 'delay':
        return { duration: 1000 };
      case 'merge':
        return { mergeStrategy: 'all', conditions: [] };
      default:
        return {};
    }
  };

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      const method = event.dataTransfer.getData('application/reactflow-method');
      const templateJson = event.dataTransfer.getData('application/reactflow-node-template');
      console.log('Drop event triggered, type:', type, 'method:', method);
      console.log('ReactFlow instance:', reactFlowInstance);

      if (!type) {
        console.error('No type data in drop event');
        return;
      }

      if (!reactFlowInstance) {
        console.error('ReactFlow instance not initialized');
        return;
      }

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      console.log('Drop position:', position);

      let config = getDefaultConfig(type);
      let labelFromTemplate = null;
      if (templateJson) {
        try {
          const parsed = JSON.parse(templateJson);
          if (parsed && parsed.type === type && parsed.config) {
            config = { ...config, ...parsed.config };
            if (parsed.label) labelFromTemplate = parsed.label;
          }
        } catch (e) {
          // ignore bad template
        }
      }
      
      // Override method if provided (for HTTP request nodes)
      if (method && type === 'http-request') {
        config.method = method;
        console.log('Setting HTTP method to:', method);
      }

      const newNode = {
        id: `${type}-${Date.now()}`,
        type,
        position,
        data: {
          label: labelFromTemplate || type.replace('-', ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
          config,
        },
      };

      console.log('Creating new node:', newNode);
      setNodes((nds) => {
        console.log('Current nodes:', nds);
        const updated = [...nds, newNode];
        console.log('Updated nodes:', updated);
        return updated;
      });
    },
    [reactFlowInstance, setNodes]
  );
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

  const [isRunning, setIsRunning] = useState(false);
  const [currentRunId, setCurrentRunId] = useState(null);
  const pollIntervalRef = useRef(null);

  const runWorkflow = useCallback(async () => {
    if (!workflowId) {
      console.warn('Please save the workflow first');
      return;
    }

    // Check if the selected environment has secrets that need values
    const envId = selectedEnvironment && selectedEnvironment.trim() ? selectedEnvironment.trim() : null;
    if (envId) {
      const selectedEnv = environments.find(e => e.environmentId === envId);
      const envSecrets = selectedEnv?.secrets || {};
      const secretKeys = Object.keys(envSecrets);
      
      if (secretKeys.length > 0) {
        // Check if all secrets are filled in sessionStorage
        const missingSecrets = secretKeys.filter(k => !sessionStorage.getItem(`secret_${k}`)?.trim());
        
        if (missingSecrets.length > 0) {
          // Show secrets prompt — after user fills them, the prompt will call onSecretsProvided
          // which triggers executeRunWithSecrets
          pendingRunRef.current = true;
          setShowSecretsPrompt(true);
          return;
        }
      }
    }
    
    // All secrets satisfied (or no secrets needed) — run directly
    executeRunWithSecrets();
  }, [workflowId, selectedEnvironment, environments]);

  // Gather sessionStorage secrets for the selected environment and fire the run
  const executeRunWithSecrets = useCallback(async () => {
    // Collect runtime secrets from sessionStorage
    const envId = selectedEnvironment && selectedEnvironment.trim() ? selectedEnvironment.trim() : null;
    let runtimeSecrets = {};
    if (envId) {
      const selectedEnv = environments.find(e => e.environmentId === envId);
      const envSecrets = selectedEnv?.secrets || {};
      Object.keys(envSecrets).forEach(key => {
        const val = sessionStorage.getItem(`secret_${key}`);
        if (val) runtimeSecrets[key] = val;
      });
    }

    // Pre-run validation: ensure nodes have valid configs (basic checks)
    // Collect missing fields per node and mark invalid nodes so UI can highlight them
    const invalidSummary = [];
    nodes.forEach((n) => {
      if (n.type === 'assertion') {
        const assertions = n.data?.config?.assertions || [];
        const missing = [];
        assertions.forEach((a, idx) => {
          if (a.source === 'status') return;
          if (['exists', 'notExists'].includes(a.operator)) {
            if (!a.path || !a.path.trim()) missing.push(`assertion[${idx}].path`);
          } else {
            if (!a.path || !a.path.trim()) missing.push(`assertion[${idx}].path`);
            if (!a.expectedValue || !String(a.expectedValue).trim()) missing.push(`assertion[${idx}].expectedValue`);
          }
        });
        if (missing.length > 0) {
          invalidSummary.push({ nodeId: n.id, missing });
        }
      }
    });

    if (invalidSummary.length > 0) {
      // Mark nodes as invalid so their components can show a red pulse/border
      const invalidIds = new Set(invalidSummary.map((s) => s.nodeId));
      setNodes((nds) => nds.map((node) => (invalidIds.has(node.id) ? { ...node, data: { ...node.data, invalid: true } } : node)));

      // Center view on first invalid node if reactFlowInstance is available
      if (reactFlowInstance && invalidSummary[0]) {
        const firstId = invalidSummary[0].nodeId;
        const target = nodes.find((n) => n.id === firstId);
        if (target) {
          try {
            reactFlowInstance.setCenter(target.position.x, target.position.y, { zoom: 1.2 });
          } catch (err) {
            // ignore if positioning fails
          }
        }
      }

      // Build readable toast message including node ids and their missing fields
      const details = invalidSummary.map((s) => `${s.nodeId}: ${s.missing.join(', ')}`).join(' | ');
      toast.error(`Run blocked: invalid node config — ${details}`, { duration: 8000 });

      // Clear invalid marks after a timeout so UI returns to normal
      setTimeout(() => {
        setNodes((nds) => nds.map((node) => (node.data && node.data.invalid ? { ...node, data: { ...node.data, invalid: false } } : node)));
      }, 6000);

      console.warn('Run blocked due to invalid node configuration', invalidSummary);
      return;
    }

    try {
      // Clear old execution status from all nodes before starting new run
      setNodes((nds) => nds.map((node) => ({
        ...node,
        data: {
          ...node.data,
          executionStatus: undefined,
          executionResult: undefined,
          executionTimestamp: undefined
        }
      })));
      
      // Start the run
      console.log('🚀 About to run workflow with:', {
        selectedEnvironment,
        type: typeof selectedEnvironment,
        isTruthy: !!selectedEnvironment,
        workflowId
      });
      
      // Debug logging removed for production. Uncomment for debugging if needed.
      // console.log('📋 Available environments:', environments.map(e => ({
      //   id: e.environmentId,
      //   name: e.name,
      //   variableCount: Object.keys(e.variables || {}).length
      // })));
      
      // if (selectedEnvironment) {
      //   const selectedEnv = environments.find(e => e.environmentId === selectedEnvironment);
      //   console.log('📦 Selected environment details:', {
      //     environmentId: selectedEnvironment,
      //     name: selectedEnv?.name,
      //     variableCount: Object.keys(selectedEnv?.variables || {}).length,
      //     variables: selectedEnv?.variables
      //   });
      // } else {
      //   console.log('⚠️ No environment selected');
      // }
      
            // Ensure selectedEnvironment is either a valid ID or null (not empty string)
            const runEnvId = selectedEnvironment && selectedEnvironment.trim() ? selectedEnvironment.trim() : null;
      
            const url = runEnvId
              ? `${API_BASE_URL}/api/workflows/${workflowId}/run?environmentId=${runEnvId}`
              : `${API_BASE_URL}/api/workflows/${workflowId}/run`;
      
            // Debug logging removed for production. Uncomment for debugging if needed.
            // console.log('📡 Request URL:', url);
            // console.log('📡 Environment ID being sent:', envId);
            // console.log('✅ Final state before fetch:', {
            //   selectedEnvironmentState: selectedEnvironment,
            //   envIdToSend: envId,
            //   urlQuery: `environmentId=${envId}`,
            //   urlFull: url
            // });
        
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: Object.keys(runtimeSecrets).length > 0
          ? JSON.stringify({ secrets: runtimeSecrets })
          : undefined,
      });
      
      if (response.ok) {
        const result = await response.json();
        // Debug logging removed for production. Uncomment for debugging if needed.
        // console.log('✅ Workflow run created:', result);
        // console.log('📋 Run Details:', {
        //   runId: result.runId,
        //   environmentId: result.environmentId,
        //   status: result.status,
        //   message: 'Check backend logs at: backend/logs/run_' + result.runId + '.log'
        // });
        
        // if (result.environmentId) {
        //   console.log('🌍 Environment will be used for variable substitution');
        //   console.log('📝 Backend will replace {{env.*}} templates in HTTP requests');
        // } else {
        //   console.log('⚠️ No environment selected - workflow variables and defaults will be used');
        // }
        
                setCurrentRunId(result.runId);
                setIsRunning(true);
        
        // Start polling for status with adaptive intervals
        // Use fast polling (100ms) for the first 2 seconds, then switch to slow polling (1s)
        let pollAttempts = 0;
        const maxInitialAttempts = 20; // 20 * 100ms = 2 seconds of fast polling
        
        const pollForStatus = async () => {
          try {
            const statusResponse = await fetch(
              `${API_BASE_URL}/api/workflows/${workflowId}/runs/${result.runId}`
            );
            
            if (statusResponse.ok) {
              const runData = await statusResponse.json();
            // Debug logging removed for production. Uncomment for debugging if needed.
            // console.log('Run status:', runData);
            
                          // Update node visuals based on status - only update changed nodes
                          if (runData.nodeStatuses) {
                            setNodes((nds) => selectiveNodeUpdate(nds, runData.nodeStatuses));
                          }
            
                          // Stop polling when run is complete
                          if (runData.status === 'completed' || runData.status === 'failed') {
                            clearInterval(pollIntervalRef.current);
                            setIsRunning(false);
                            // console.log(`Workflow ${runData.status}!`);
                          }
                        }
          } catch (error) {
            console.error('Status poll error:', error);
          }
        };
        
        // Fast polling for first ~2 seconds (100ms), then switch to 1s interval
        const fastPollInterval = setInterval(() => {
          pollForStatus();
          pollAttempts++;
          
          if (pollAttempts >= maxInitialAttempts) {
            // Switch to slower 1 second interval after initial fast polling
            clearInterval(fastPollInterval);
            pollIntervalRef.current = setInterval(pollForStatus, 1000);
          }
        }, 100);
        
        pollIntervalRef.current = fastPollInterval;
      } else {
        const error = await response.text();
        console.error(`Failed to run workflow: ${error}`);
      }
    } catch (error) {
      console.error('Run error:', error);
    }
  }, [workflowId, setNodes, selectedEnvironment, environments]);

  // Handle secrets provided from SecretsPrompt — continue the pending run
  const handleSecretsProvided = useCallback((secrets) => {
    setShowSecretsPrompt(false);
    if (pendingRunRef.current) {
      pendingRunRef.current = false;
      executeRunWithSecrets();
    }
  }, [executeRunWithSecrets]);

  const loadHistoricalRun = useCallback(async (run) => {
    console.log('Loading historical run:', run);
    
    try {
      // Fetch full run details including nodeStatuses
      const response = await fetch(
        `${API_BASE_URL}/api/workflows/${workflowId}/runs/${run.runId}`
      );
      
      if (response.ok) {
        const fullRunData = await response.json();
        console.log('Full run data loaded:', fullRunData);
        
        // Update nodes with the historical run data
        if (fullRunData.nodeStatuses) {
          setNodes((nds) => selectiveNodeUpdate(nds, fullRunData.nodeStatuses));
        }
        
        // Set the current run ID to the historical one
        setCurrentRunId(fullRunData.runId);
      } else {
        console.error('Failed to load run details');
      }
    } catch (error) {
      console.error('Error loading run details:', error);
    }
  }, [workflowId, setNodes]);

  // Load persisted auto-save setting for this workflow
  useEffect(() => {
    if (!workflowId) return;
    try {
      const stored = localStorage.getItem(`autoSave_${workflowId}`);
      if (stored !== null) setAutoSaveEnabled(stored === 'true');
    } catch (err) {
      // ignore
    }
  }, [workflowId]);

  // Persist auto-save setting when toggled
  useEffect(() => {
    if (!workflowId) return;
    try {
      localStorage.setItem(`autoSave_${workflowId}`, autoSaveEnabled ? 'true' : 'false');
    } catch (err) {
      // ignore
    }
  }, [autoSaveEnabled, workflowId]);

  // Debounced auto-save when nodes, edges, or variables change
  useEffect(() => {
    if (!autoSaveEnabled) return;
    if (!workflowId) return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    // Mark tab as dirty immediately when changes are detected
    useTabStore.getState().markDirty(workflowId);

    autoSaveTimerRef.current = setTimeout(() => {
      console.log('🔄 Auto-saving workflow...');
      saveWorkflow(true);
      autoSaveTimerRef.current = null;
    }, 700);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [nodes, edges, workflowVariables, autoSaveEnabled, workflowId, saveWorkflow]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

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
          className="dark:bg-gray-900"
          color={darkMode ? "#444" : "#aaa"}
        />
        <Controls className="border-cyan-900 shadow-md dark:border-gray-700" />
        
        {/* Top-left MiniMap */}
        <Panel position="top-left">
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
              width: 200,
              height: 150
            }}
            zoomable 
            pannable 
          />
        </Panel>
      </ReactFlow>

      {/* Top Control Bar - Positioned absolutely within the canvas container */}
      <div className="absolute top-4 right-4 z-50 flex gap-2 items-center pointer-events-auto justify-end min-h-10">
        <button
          onClick={() => saveWorkflow(false)}
          className="flex items-center gap-2 px-4 py-2 bg-cyan-900 text-white rounded-lg hover:bg-cyan-950 shadow-lg font-medium transition-colors dark:bg-cyan-800 dark:hover:bg-cyan-900 whitespace-nowrap h-10"
        >
          <Save className="w-4 h-4 flex-shrink-0" />
          <span className="leading-none self-center">Save</span>
        </button>
        <button
          onClick={() => setShowHistory(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 shadow-lg font-medium transition-colors dark:bg-gray-600 dark:hover:bg-gray-700 whitespace-nowrap h-10"
          title="View run history"
        >
          <History className="w-4 h-4 flex-shrink-0" />
          <span className="leading-none self-center">History</span>
        </button>
        
        <button
          onClick={() => setShowJsonEditor(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-lg font-medium transition-colors dark:bg-indigo-700 dark:hover:bg-indigo-800 whitespace-nowrap h-10"
          title="View and edit raw workflow JSON"
        >
          <Code className="w-4 h-4 flex-shrink-0" />
          <span className="leading-none self-center">JSON</span>
        </button>
        
        <button
          onClick={() => setShowImportToNodes(true)}
          className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 shadow-lg font-medium transition-colors dark:bg-amber-700 dark:hover:bg-amber-800 whitespace-nowrap h-10"
          title="Import OpenAPI, HAR, or Curl to Add Nodes panel"
        >
          <Upload className="w-4 h-4 flex-shrink-0" />
          <span className="leading-none self-center">Import</span>
        </button>
        
        {/* Environment Selector */}
        <div className="flex items-center h-10">
          <ButtonSelect
            key={`env-select-${workflowId}`}
            options={[{ value: '', label: 'No Environment' }, ...environments.map(e => ({ value: e.environmentId, label: e.name }))]}
            value={selectedEnvironment || ''}
            onChange={(val) => {
              // Normalize: empty string or whitespace becomes null
              const processed = (val && val.trim()) ? val.trim() : null;
              const selectedEnv = environments.find(e => e.environmentId === processed);
              const envName = selectedEnv ? selectedEnv.name : 'No Environment';
              
              console.log('🔄 Environment selection changed:', { 
                previousEnvironment: selectedEnvironment,
                newEnvironment: processed,
                raw: val, 
                processed,
                willUseEnvironment: !!processed,
                envName,
                environments: environments.map(e => ({ id: e.environmentId, name: e.name }))
              });
              
              // Update state - this triggers the useEffect that saves to localStorage
              setSelectedEnvironment(processed);
              
              // Show notification for 2 seconds
              setEnvironmentChangeNotification(`✓ Environment changed to: ${envName}`);
              setTimeout(() => setEnvironmentChangeNotification(null), 2000);
            }}
            placeholder="No Environment"
            buttonClass="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white rounded-lg font-medium leading-none shadow-lg transition-colors h-10 whitespace-nowrap"
          />
        </div>
        
        <button
          onClick={runWorkflow}
          disabled={isRunning}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 shadow-lg font-medium transition-colors dark:bg-green-700 dark:hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap h-10"
        >
          <Play className="w-4 h-4 flex-shrink-0" />
          <span className="leading-none self-center">{isRunning ? 'Running...' : 'Run'}</span>
        </button>
      </div>

      {/* Add Nodes Panel - OUTSIDE ReactFlow */}
      <AddNodesPanel isModalOpen={!!modalNode} isPanelOpen={isPanelOpen} showVariablesPanel={showVariablesPanel} onShowVariablesPanel={onShowVariablesPanel} />

      {/* Node Modal */}
      {modalNode && (
        <NodeModal
          node={modalNode}
          onClose={() => setModalNode(null)}
          onSave={handleModalSave}
        />
      )}

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
      
      {/* Environment Change Notification */}
      {environmentChangeNotification && (
        <div className="fixed bottom-20 right-4 bg-green-500 dark:bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg animate-pulse z-40">
          {environmentChangeNotification}
        </div>
      )}
    </div>
  );
};

export default WorkflowCanvas;
