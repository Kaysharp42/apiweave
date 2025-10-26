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
import AddNodesPanel from './AddNodesPanel';
import VariablesPanel from './VariablesPanel';
import NodeModal from './NodeModal';
import HistoryModal from './HistoryModal';
import { AppContext } from '../App';
import Toaster, { toast } from './Toaster';

// Update node statuses - always update to ensure fresh data on each run
const selectiveNodeUpdate = (currentNodes, nodeStatuses) => {
  return currentNodes.map((node) => {
    const nodeStatus = nodeStatuses[node.id];
    if (!nodeStatus) return node;
    
    // Always update to ensure fresh results on each run
    return {
      ...node,
      data: {
        ...node.data,
        executionStatus: nodeStatus?.status,
        executionResult: nodeStatus?.result, // Full response with fresh data
        executionTimestamp: nodeStatus?.timestamp, // Track when result was generated
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

const initialNodes = [
  {
    id: 'start-1',
    type: 'start',
    position: { x: 250, y: 50 },
    data: { label: 'Start' },
  },
];

const WorkflowCanvas = ({ workflowId, workflow, isPanelOpen = false }) => {
  console.log('WorkflowCanvas rendered with:', { workflowId, workflow });
  
  // Get global state from context
  const context = useContext(AppContext);
  console.log('WorkflowCanvas context:', context);
  const { darkMode, autoSaveEnabled } = context || { darkMode: false, autoSaveEnabled: true };
  
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const [workflowVariables, setWorkflowVariables] = useState({});
  const [modalNode, setModalNode] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  // Auto-save timer reference
  const autoSaveTimerRef = useRef(null);

  // Sync extractors from all nodes to workflow variables
  useEffect(() => {
    const allExtractors = {};
    nodes.forEach(node => {
      if (node.type === 'http-request' && node.data.config?.extractors) {
        Object.assign(allExtractors, node.data.config.extractors);
      }
    });
    
    // Merge extractors with manually added variables (keep manually added ones, add extractors)
    setWorkflowVariables(prev => ({
      ...allExtractors,
      ...Object.fromEntries(
        Object.entries(prev).filter(([key]) => !Object.keys(allExtractors).includes(key))
      )
    }));
  }, [nodes]);

  // Detect parallel branches and update node data with branch counts
  useEffect(() => {
    // Count outgoing edges per node
    const branchCounts = {};
    edges.forEach(edge => {
      branchCounts[edge.source] = (branchCounts[edge.source] || 0) + 1;
    });

    // Count incoming edges per node (for merge detection)
    const incomingCounts = {};
    edges.forEach(edge => {
      incomingCounts[edge.target] = (incomingCounts[edge.target] || 0) + 1;
    });

    // Update nodes with branch info
    setNodes(nds => nds.map(node => ({
      ...node,
      data: {
        ...node.data,
        branchCount: branchCounts[node.id] || 0,
        incomingBranchCount: incomingCounts[node.id] || 0,
      }
    })));
  }, [edges]);

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
        label: edge.label,
      }));
      
      setNodes(loadedNodes);
      setEdges(loadedEdges);
      
      // Load workflow variables
      if (workflow.variables) {
        setWorkflowVariables(workflow.variables);
      }
    }
  }, [workflow]);

  const onConnect = useCallback(
    (params) => {
      setEdges((eds) => {
        const newEdge = addEdge(params, eds)[eds.length];
        
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
        
        return addEdge(params, eds);
      });
    },
    [setEdges, darkMode, nodes]
  );

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
      console.log('Drop event triggered, type:', type);
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

      const newNode = {
        id: `${type}-${Date.now()}`,
        type,
        position,
        data: {
          label: type.replace('-', ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
          config: getDefaultConfig(type),
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
        label: edge.label || null,
      })),
      variables: workflowVariables,
    };

    try {
      const response = await fetch(`http://localhost:8000/api/workflows/${workflowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflow),
      });
      
      if (response.ok) {
        console.log('Workflow saved successfully');
      } else {
        console.error('Failed to save workflow');
      }
    } catch (error) {
      console.error('Save error:', error);
    }
  }, [nodes, edges, workflowId, workflowVariables]);

  const [isRunning, setIsRunning] = useState(false);
  const [currentRunId, setCurrentRunId] = useState(null);
  const pollIntervalRef = useRef(null);

  const runWorkflow = useCallback(async () => {
    if (!workflowId) {
      console.warn('Please save the workflow first');
      return;
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
      toast(`Run blocked: invalid node config — ${details}`, { type: 'error', duration: 8000 });

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
      const response = await fetch(`http://localhost:8000/api/workflows/${workflowId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('Workflow run started:', result);
        setCurrentRunId(result.runId);
        setIsRunning(true);
        
        // Start polling for status
        pollIntervalRef.current = setInterval(async () => {
          try {
            const statusResponse = await fetch(
              `http://localhost:8000/api/workflows/${workflowId}/runs/${result.runId}`
            );
            
            if (statusResponse.ok) {
              const runData = await statusResponse.json();
              console.log('Run status:', runData);
              
              // Update node visuals based on status - only update changed nodes
              if (runData.nodeStatuses) {
                setNodes((nds) => selectiveNodeUpdate(nds, runData.nodeStatuses));
              }
              
              // Stop polling when run is complete
              if (runData.status === 'completed' || runData.status === 'failed') {
                clearInterval(pollIntervalRef.current);
                setIsRunning(false);
                console.log(`Workflow ${runData.status}!`);
              }
            }
          } catch (error) {
            console.error('Status poll error:', error);
          }
        }, 1000); // Poll every second
      } else {
        const error = await response.text();
        console.error(`Failed to run workflow: ${error}`);
      }
    } catch (error) {
      console.error('Run error:', error);
    }
  }, [workflowId, setNodes]);

  const loadHistoricalRun = useCallback(async (run) => {
    console.log('Loading historical run:', run);
    
    try {
      // Fetch full run details including nodeStatuses
      const response = await fetch(
        `http://localhost:8000/api/workflows/${workflowId}/runs/${run.runId}`
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

  // Debounced auto-save when nodes or edges change
  useEffect(() => {
    if (!autoSaveEnabled) return;
    if (!workflowId) return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    autoSaveTimerRef.current = setTimeout(() => {
      saveWorkflow(true);
      autoSaveTimerRef.current = null;
    }, 700);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [nodes, edges, autoSaveEnabled, workflowId, saveWorkflow]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  return (
    <div className="w-full h-screen relative bg-gray-50 dark:bg-gray-900 transition-colors">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onInit={setReactFlowInstance}
        onDrop={onDrop}
        onDragOver={onDragOver}
        nodeTypes={nodeTypes}
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

        {/* Top Control Bar */}
        <Panel position="top-right" className="flex gap-2 items-center">
          <button
            onClick={() => saveWorkflow(false)}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-900 text-white rounded-lg hover:bg-cyan-950 shadow-lg font-medium transition-colors dark:bg-cyan-800 dark:hover:bg-cyan-900"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            <span className="leading-none self-center">Save</span>
          </button>
          <button
            onClick={() => setShowHistory(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 shadow-lg font-medium transition-colors dark:bg-gray-600 dark:hover:bg-gray-700"
            title="View run history"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="leading-none self-center">History</span>
          </button>
          <button
            onClick={runWorkflow}
            disabled={isRunning}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 shadow-lg font-medium transition-colors dark:bg-green-700 dark:hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
            </svg>
            <span className="leading-none self-center">{isRunning ? 'Running...' : 'Run'}</span>
          </button>
        </Panel>
      </ReactFlow>

  {/* Toast container */}
  <Toaster />

      {/* Add Nodes Panel - OUTSIDE ReactFlow */}
      <AddNodesPanel isModalOpen={!!modalNode} isPanelOpen={isPanelOpen} />

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
    </div>
  );
};

export default WorkflowCanvas;
