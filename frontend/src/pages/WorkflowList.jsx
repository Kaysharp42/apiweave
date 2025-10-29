import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import API_BASE_URL from '../utils/api';

const WorkflowList = () => {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newWorkflowName, setNewWorkflowName] = useState('');
  const [newWorkflowDesc, setNewWorkflowDesc] = useState('');

  useEffect(() => {
    fetchWorkflows();
  }, []);

  const fetchWorkflows = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/workflows`);
      const data = await response.json();
      setWorkflows(data);
    } catch (error) {
      console.error('Error fetching workflows:', error);
    } finally {
      setLoading(false);
    }
  };

  const createWorkflow = async () => {
    if (!newWorkflowName.trim()) {
      alert('Please enter a workflow name');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newWorkflowName,
          description: newWorkflowDesc,
          nodes: [{
            nodeId: 'start-1',
            type: 'start',
            label: 'Start',
            position: { x: 250, y: 50 },
            config: {}
          }],
          edges: [],
          variables: {},
          tags: [],
        }),
      });

      if (response.ok) {
        const newWorkflow = await response.json();
        setNewWorkflowName('');
        setNewWorkflowDesc('');
        setShowCreate(false);
        // Navigate to the new workflow editor
        navigate(`/workflows/${newWorkflow.workflowId}`);
      } else {
        alert('Failed to create workflow');
      }
    } catch (error) {
      console.error('Error creating workflow:', error);
      alert('Error creating workflow');
    }
  };

  const deleteWorkflow = async (workflowId) => {
    if (!confirm('Are you sure you want to delete this workflow?')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchWorkflows();
      } else {
        alert('Failed to delete workflow');
      }
    } catch (error) {
      console.error('Error deleting workflow:', error);
      alert('Error deleting workflow');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-xl dark:text-gray-200">Loading workflows...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold dark:text-gray-100">Workflows</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800"
        >
          + Create Workflow
        </button>
      </div>

      {showCreate && (
        <div className="mb-6 p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md border dark:border-gray-700">
          <h2 className="text-xl font-bold mb-4 dark:text-gray-100">Create New Workflow</h2>
          <input
            type="text"
            placeholder="Workflow Name"
            value={newWorkflowName}
            onChange={(e) => setNewWorkflowName(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400 rounded-lg mb-4"
          />
          <textarea
            placeholder="Description (optional)"
            value={newWorkflowDesc}
            onChange={(e) => setNewWorkflowDesc(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400 rounded-lg mb-4"
            rows={3}
          />
          <div className="flex gap-2">
            <button
              onClick={createWorkflow}
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800"
            >
              Create
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-6 py-2 bg-gray-300 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {workflows.map((workflow) => (
          <div key={workflow.workflowId} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 border dark:border-gray-700">
            <h3 className="text-xl font-bold mb-2 dark:text-gray-100">{workflow.name}</h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">{workflow.description || 'No description'}</p>
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              <div>{workflow.nodes.length} nodes</div>
              <div>Version {workflow.version}</div>
            </div>
            <div className="flex gap-2">
              <Link
                to={`/workflows/${workflow.workflowId}`}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 text-center"
              >
                Edit
              </Link>
              <button
                onClick={() => deleteWorkflow(workflow.workflowId)}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {workflows.length === 0 && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <p className="text-xl mb-4">No workflows yet</p>
          <p>Create your first workflow to get started!</p>
        </div>
      )}
    </div>
  );
};

export default WorkflowList;
