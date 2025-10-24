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
import AddNodesPanel from './AddNodesPanel';
import VariablesPanel from './VariablesPanel';
import { AppContext } from '../App';

const nodeTypes = {
  'http-request': HTTPRequestNode,
  'assertion': AssertionNode,
  'delay': DelayNode,
  'start': StartNode,
  'end': EndNode,
};

const initialNodes = [
  {
    id: 'start-1',
    type: 'start',
    position: { x: 250, y: 50 },
    data: { label: 'Start' },
  },
];

const WorkflowCanvas = ({ workflowId, workflow }) => {
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
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node);
  }, []);

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

    try {
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
              
              // Update node visuals based on status
              if (runData.nodeStatuses) {
                setNodes((nds) => 
                  nds.map((node) => {
                    const nodeStatus = runData.nodeStatuses[node.id];
                    return {
                      ...node,
                      data: {
                        ...node.data,
                        executionStatus: nodeStatus?.status,
                        executionResult: nodeStatus?.result,
                      },
                    };
                  })
                );
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
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            <span>Save</span>
          </button>
          <button
            onClick={runWorkflow}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 shadow-lg font-medium transition-colors dark:bg-green-700 dark:hover:bg-green-800"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
            </svg>
            <span>Run</span>
          </button>
        </Panel>
      </ReactFlow>

      {/* Add Nodes Panel - OUTSIDE ReactFlow */}
      <AddNodesPanel />
    </div>
  );
};

export default WorkflowCanvas;
