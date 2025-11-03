import React, { useState, useEffect } from 'react';
import API_BASE_URL from '../utils/api';
import { Trash2, Plus, X, GripVertical, Eye, EyeOff, ArrowLeft } from 'lucide-react';

const CollectionManager = ({ onClose }) => {
  const [collections, setCollections] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [selectedCol, setSelectedCol] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isManagingWorkflows, setIsManagingWorkflows] = useState(false);
  const [workflowOrder, setWorkflowOrder] = useState([]);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [continueOnFail, setContinueOnFail] = useState(true);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: '#3B82F6'
  });
  const [error, setError] = useState('');

  const PRESET_COLORS = [
    '#3B82F6', // Blue
    '#EF4444', // Red
    '#10B981', // Green
    '#F59E0B', // Amber
    '#8B5CF6', // Purple
    '#EC4899', // Pink
    '#06B6D4', // Cyan
    '#6366F1', // Indigo
    '#14B8A6', // Teal
    '#F97316', // Orange
  ];

  useEffect(() => {
    fetchCollections();
    fetchWorkflows();
  }, []);

  const fetchWorkflows = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/workflows`);
      if (response.ok) {
        const data = await response.json();
        const workflowsList = Array.isArray(data) ? data : data.workflows || [];
        setWorkflows(workflowsList);
      }
    } catch (error) {
      console.error('Error fetching workflows:', error);
    }
  };

  const fetchCollections = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/collections`);
      if (response.ok) {
        const data = await response.json();
        setCollections(data);
      }
    } catch (error) {
      console.error('Error fetching collections:', error);
      setError('Failed to fetch collections');
    }
  };

  const handleCreate = () => {
    setIsEditing(true);
    setSelectedCol(null);
    setFormData({
      name: '',
      description: '',
      color: '#3B82F6'
    });
    setError('');
  };

  const handleEdit = (col) => {
    setIsEditing(true);
    setSelectedCol(col);
    setFormData({
      name: col.name,
      description: col.description || '',
      color: col.color || '#3B82F6'
    });
    setError('');
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      setError('Collection name is required');
      return;
    }

    try {
      const url = selectedCol
        ? `${API_BASE_URL}/api/collections/${selectedCol.collectionId}`
        : `${API_BASE_URL}/api/collections`;
      
      const method = selectedCol ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        await fetchCollections();
        setIsEditing(false);
        setSelectedCol(null);
        setError('');
        // Notify other components that collections have changed
        window.dispatchEvent(new CustomEvent('collectionsChanged'));
      } else {
        const errorData = await response.json();
        setError(errorData.detail || 'Failed to save collection');
      }
    } catch (error) {
      console.error('Error saving collection:', error);
      setError('Error saving collection');
    }
  };

  const handleDelete = async (colId) => {
    if (!confirm('Are you sure you want to delete this collection?')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/collections/${colId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        await fetchCollections();
        if (selectedCol?.collectionId === colId) {
          setSelectedCol(null);
          setIsEditing(false);
        }
        // Notify other components that collections have changed
        window.dispatchEvent(new CustomEvent('collectionsChanged'));
      } else {
        const errorData = await response.json();
        alert(errorData.detail || 'Failed to delete collection');
      }
    } catch (error) {
      console.error('Error deleting collection:', error);
      alert('Error deleting collection');
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setSelectedCol(null);
    setError('');
  };

  const handleManageWorkflows = async (col) => {
    setSelectedCol(col);
    setIsManagingWorkflows(true);
    setContinueOnFail(col.continueOnFail !== undefined ? col.continueOnFail : true);
    
    // Get workflows in this collection
    const collectionWorkflows = workflows.filter(w => w.collectionId === col.collectionId);
    
    // Initialize workflow order from backend or create default order
    if (col.workflowOrder && col.workflowOrder.length > 0) {
      // Use existing order from backend
      const orderedWorkflows = col.workflowOrder
        .sort((a, b) => a.order - b.order)
        .map(wo => {
          const workflow = collectionWorkflows.find(w => w.workflowId === wo.workflowId);
          return {
            ...wo,
            workflow: workflow
          };
        })
        .filter(wo => wo.workflow); // Remove any workflows that no longer exist
      
      setWorkflowOrder(orderedWorkflows);
    } else {
      // Create default order
      const defaultOrder = collectionWorkflows.map((workflow, index) => ({
        workflowId: workflow.workflowId,
        order: index,
        enabled: true,
        continueOnFail: true,
        workflow: workflow
      }));
      setWorkflowOrder(defaultOrder);
    }
  };

  const handleBackFromWorkflows = () => {
    setIsManagingWorkflows(false);
    setSelectedCol(null);
    setWorkflowOrder([]);
  };

  const handleSaveWorkflowOrder = async () => {
    if (!selectedCol) return;

    try {
      // Prepare the workflowOrder data
      const orderData = workflowOrder.map((wo, index) => ({
        workflowId: wo.workflowId,
        order: index,
        enabled: wo.enabled,
        continueOnFail: wo.continueOnFail
      }));

      const response = await fetch(`${API_BASE_URL}/api/collections/${selectedCol.collectionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowOrder: orderData,
          continueOnFail: continueOnFail
        })
      });

      if (response.ok) {
        await fetchCollections();
        setIsManagingWorkflows(false);
        setSelectedCol(null);
        setWorkflowOrder([]);
        window.dispatchEvent(new CustomEvent('collectionsChanged'));
      } else {
        const errorData = await response.json();
        alert(errorData.detail || 'Failed to save workflow order');
      }
    } catch (error) {
      console.error('Error saving workflow order:', error);
      alert('Error saving workflow order');
    }
  };

  const handleDragStart = (index) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newOrder = [...workflowOrder];
    const draggedItem = newOrder[draggedIndex];
    newOrder.splice(draggedIndex, 1);
    newOrder.splice(index, 0, draggedItem);

    setWorkflowOrder(newOrder);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const toggleWorkflowEnabled = (index) => {
    const newOrder = [...workflowOrder];
    newOrder[index].enabled = !newOrder[index].enabled;
    setWorkflowOrder(newOrder);
  };

  const toggleWorkflowContinueOnFail = (index) => {
    const newOrder = [...workflowOrder];
    newOrder[index].continueOnFail = !newOrder[index].continueOnFail;
    setWorkflowOrder(newOrder);
  };

  const removeWorkflowFromOrder = (index) => {
    const newOrder = [...workflowOrder];
    newOrder.splice(index, 1);
    setWorkflowOrder(newOrder);
  };

  const addWorkflowToOrder = (workflowId) => {
    const workflow = workflows.find(w => w.workflowId === workflowId);
    if (!workflow) return;

    const newOrder = [...workflowOrder, {
      workflowId: workflow.workflowId,
      order: workflowOrder.length,
      enabled: true,
      continueOnFail: true,
      workflow: workflow
    }];
    setWorkflowOrder(newOrder);
  };

  const availableWorkflows = workflows.filter(
    w => w.collectionId === selectedCol?.collectionId && 
         !workflowOrder.some(wo => wo.workflowId === w.workflowId)
  );

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={(e) => {
        // Close only if clicking on the backdrop itself, not the modal
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg max-w-4xl w-full max-h-[80vh] mx-4 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-300 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            {isManagingWorkflows && (
              <button
                onClick={handleBackFromWorkflows}
                className="p-1 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-200">
              {isManagingWorkflows 
                ? `Manage Workflows: ${selectedCol?.name}` 
                : isEditing 
                  ? (selectedCol ? 'Edit Collection' : 'Create Collection') 
                  : 'Collections'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {isManagingWorkflows ? (
            // Workflow Order Management
            <div className="space-y-4">
              {/* Global Continue on Fail Toggle */}
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={continueOnFail}
                    onChange={(e) => setContinueOnFail(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                    Continue on Failure (Collection-wide)
                  </span>
                </label>
                <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                  When enabled, workflow execution continues even if a workflow fails
                </p>
              </div>

              {/* Workflow Order List */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Execution Order (drag to reorder)
                </h3>
                {workflowOrder.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
                    No workflows in this collection yet
                  </div>
                ) : (
                  <div className="space-y-2">
                    {workflowOrder.map((wo, index) => (
                      <div
                        key={wo.workflowId}
                        draggable
                        onDragStart={() => handleDragStart(index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDragEnd={handleDragEnd}
                        className={`flex items-center gap-2 p-3 border rounded transition-all ${
                          draggedIndex === index
                            ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-900/20 opacity-50'
                            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700'
                        } ${!wo.enabled ? 'opacity-60' : ''}`}
                      >
                        {/* Drag Handle */}
                        <div className="cursor-grab active:cursor-grabbing text-gray-400">
                          <GripVertical className="w-5 h-5" />
                        </div>

                        {/* Order Number */}
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-cyan-100 dark:bg-cyan-900 text-cyan-800 dark:text-cyan-200 flex items-center justify-center font-semibold text-sm">
                          {index + 1}
                        </div>

                        {/* Workflow Name */}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-800 dark:text-gray-200 truncate">
                            {wo.workflow?.name || wo.workflowId}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {wo.workflow?.nodes?.length || 0} nodes
                          </div>
                        </div>

                        {/* Enabled Toggle */}
                        <button
                          onClick={() => toggleWorkflowEnabled(index)}
                          className={`p-1.5 rounded transition-colors ${
                            wo.enabled
                              ? 'text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/20'
                              : 'text-gray-400 dark:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
                          }`}
                          title={wo.enabled ? 'Enabled' : 'Disabled'}
                        >
                          {wo.enabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                        </button>

                        {/* Continue on Fail Toggle */}
                        <button
                          onClick={() => toggleWorkflowContinueOnFail(index)}
                          className={`px-2 py-1 text-xs rounded transition-colors ${
                            wo.continueOnFail
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200'
                              : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'
                          }`}
                          title={wo.continueOnFail ? 'Continue on fail' : 'Stop on fail'}
                        >
                          {wo.continueOnFail ? 'Continue' : 'Stop'}
                        </button>

                        {/* Remove Button */}
                        <button
                          onClick={() => removeWorkflowFromOrder(index)}
                          className="p-1 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/20 rounded transition-colors"
                          title="Remove from collection"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add Workflows */}
              {availableWorkflows.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Add More Workflows
                  </h3>
                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        addWorkflowToOrder(e.target.value);
                        e.target.value = '';
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                  >
                    <option value="">Select a workflow to add...</option>
                    {availableWorkflows.map((w) => (
                      <option key={w.workflowId} value={w.workflowId}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Save/Cancel Buttons */}
              <div className="flex gap-2 justify-end pt-4 border-t border-gray-300 dark:border-gray-700">
                <button
                  onClick={handleBackFromWorkflows}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveWorkflowOrder}
                  className="px-4 py-2 text-white bg-cyan-900 dark:bg-cyan-800 rounded hover:bg-cyan-950 dark:hover:bg-cyan-900 transition-colors"
                >
                  Save Order
                </button>
              </div>
            </div>
          ) : isEditing ? (
            // Edit Form
            <div className="space-y-4">
              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-400">
                  {error}
                </div>
              )}

              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Collection Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-cyan-500"
                  placeholder="e.g., Staging Tests"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-cyan-500 resize-none"
                  placeholder="Optional description..."
                  rows="3"
                />
              </div>

              {/* Color Picker */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Collection Color
                </label>
                <div className="flex gap-2 flex-wrap">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setFormData({ ...formData, color })}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${
                        formData.color === color
                          ? 'border-gray-800 dark:border-gray-200 scale-110'
                          : 'border-gray-300 dark:border-gray-600'
                      }`}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              </div>

              {/* Buttons */}
              <div className="flex gap-2 justify-end pt-4">
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-2 text-white bg-cyan-900 dark:bg-cyan-800 rounded hover:bg-cyan-950 dark:hover:bg-cyan-900 transition-colors"
                >
                  {selectedCol ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          ) : (
            // Collections List
            <div className="space-y-2">
              {collections.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <p>No collections yet</p>
                  <p className="text-sm mt-2">Create one to organize your workflows</p>
                </div>
              ) : (
                collections.map((col) => (
                  <div
                    key={col.collectionId}
                    className="p-3 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {col.color && (
                          <div
                            className="w-4 h-4 rounded-full flex-shrink-0"
                            style={{ backgroundColor: col.color }}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-gray-800 dark:text-gray-200 truncate">
                            {col.name}
                          </div>
                          {col.description && (
                            <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                              {col.description}
                            </div>
                          )}
                          <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                            {col.workflowCount} workflow{col.workflowCount !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => handleManageWorkflows(col)}
                          className="px-2 py-1 text-xs bg-purple-600 dark:bg-purple-700 text-white rounded hover:bg-purple-700 dark:hover:bg-purple-800 transition-colors"
                          title="Manage workflow order"
                        >
                          Order
                        </button>
                        <button
                          onClick={() => handleEdit(col)}
                          className="px-2 py-1 text-xs bg-cyan-900 dark:bg-cyan-800 text-white rounded hover:bg-cyan-950 dark:hover:bg-cyan-900 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(col.collectionId)}
                          className="p-1 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/20 rounded transition-colors"
                          title="Delete collection"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!isEditing && (
          <div className="p-4 border-t border-gray-300 dark:border-gray-700 flex gap-2 justify-end flex-shrink-0">
            <button
              onClick={handleCreate}
              className="flex items-center gap-2 px-4 py-2 text-white bg-cyan-900 dark:bg-cyan-800 rounded hover:bg-cyan-950 dark:hover:bg-cyan-900 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Collection
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CollectionManager;
