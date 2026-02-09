import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Trash2, Plus, X, GripVertical, Eye, EyeOff, ArrowLeft, Pencil, ListOrdered } from 'lucide-react';
import API_BASE_URL from '../utils/api';
import { Modal, ConfirmDialog } from './molecules';
import { Button } from './atoms';
import useSidebarStore from '../stores/SidebarStore';

const CollectionManager = ({ open, onClose }) => {
  const [collections, setCollections] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [selectedCol, setSelectedCol] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isManagingWorkflows, setIsManagingWorkflows] = useState(false);
  const [workflowOrder, setWorkflowOrder] = useState([]);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [continueOnFail, setContinueOnFail] = useState(true);
  const [formData, setFormData] = useState({ name: '', description: '', color: '#3B82F6' });
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  const PRESET_COLORS = [
    '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
    '#EC4899', '#06B6D4', '#6366F1', '#14B8A6', '#F97316',
  ];

  useEffect(() => {
    if (open) {
      fetchCollections();
      fetchWorkflows();
    }
  }, [open]);

  const fetchWorkflows = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/workflows`);
      if (response.ok) {
        const data = await response.json();
        setWorkflows(Array.isArray(data) ? data : data.workflows || []);
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
    }
  };

  const handleCreate = () => {
    setIsEditing(true);
    setSelectedCol(null);
    setFormData({ name: '', description: '', color: '#3B82F6' });
    setError('');
  };

  const handleEdit = (col) => {
    setIsEditing(true);
    setSelectedCol(col);
    setFormData({ name: col.name, description: col.description || '', color: col.color || '#3B82F6' });
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
        toast.success(selectedCol ? 'Collection updated' : 'Collection created');
        await fetchCollections();
        setIsEditing(false);
        setSelectedCol(null);
        setError('');
        useSidebarStore.getState().signalCollectionsRefresh();
      } else {
        const errorData = await response.json();
        setError(errorData.detail || 'Failed to save collection');
      }
    } catch (error) {
      console.error('Error saving collection:', error);
      setError('Error saving collection');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/collections/${deleteTarget}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        toast.success('Collection deleted');
        await fetchCollections();
        if (selectedCol?.collectionId === deleteTarget) {
          setSelectedCol(null);
          setIsEditing(false);
        }
        useSidebarStore.getState().signalCollectionsRefresh();
      } else {
        const errorData = await response.json();
        toast.error(errorData.detail || 'Failed to delete collection');
      }
    } catch (error) {
      console.error('Error deleting collection:', error);
      toast.error('Error deleting collection');
    } finally {
      setDeleteTarget(null);
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
    const collectionWorkflows = workflows.filter(w => w.collectionId === col.collectionId);
    if (col.workflowOrder && col.workflowOrder.length > 0) {
      const orderedWorkflows = col.workflowOrder
        .sort((a, b) => a.order - b.order)
        .map(wo => ({ ...wo, workflow: collectionWorkflows.find(w => w.workflowId === wo.workflowId) }))
        .filter(wo => wo.workflow);
      setWorkflowOrder(orderedWorkflows);
    } else {
      setWorkflowOrder(collectionWorkflows.map((workflow, index) => ({
        workflowId: workflow.workflowId, order: index, enabled: true, continueOnFail: true, workflow
      })));
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
      const orderData = workflowOrder.map((wo, index) => ({
        workflowId: wo.workflowId, order: index, enabled: wo.enabled, continueOnFail: wo.continueOnFail
      }));
      const response = await fetch(`${API_BASE_URL}/api/collections/${selectedCol.collectionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowOrder: orderData, continueOnFail })
      });
      if (response.ok) {
        toast.success('Workflow order saved');
        await fetchCollections();
        setIsManagingWorkflows(false);
        setSelectedCol(null);
        setWorkflowOrder([]);
        useSidebarStore.getState().signalCollectionsRefresh();
      } else {
        const errorData = await response.json();
        toast.error(errorData.detail || 'Failed to save workflow order');
      }
    } catch (error) {
      console.error('Error saving workflow order:', error);
      toast.error('Error saving workflow order');
    }
  };

  const handleDragStart = (index) => setDraggedIndex(index);
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
  const handleDragEnd = () => setDraggedIndex(null);
  const toggleWorkflowEnabled = (i) => { const n = [...workflowOrder]; n[i].enabled = !n[i].enabled; setWorkflowOrder(n); };
  const toggleWorkflowContinueOnFail = (i) => { const n = [...workflowOrder]; n[i].continueOnFail = !n[i].continueOnFail; setWorkflowOrder(n); };
  const removeWorkflowFromOrder = (i) => { const n = [...workflowOrder]; n.splice(i, 1); setWorkflowOrder(n); };
  const addWorkflowToOrder = (workflowId) => {
    const workflow = workflows.find(w => w.workflowId === workflowId);
    if (!workflow) return;
    setWorkflowOrder([...workflowOrder, { workflowId: workflow.workflowId, order: workflowOrder.length, enabled: true, continueOnFail: true, workflow }]);
  };

  const availableWorkflows = workflows.filter(
    w => w.collectionId === selectedCol?.collectionId && !workflowOrder.some(wo => wo.workflowId === w.workflowId)
  );

  const modalTitle = isManagingWorkflows
    ? `Manage Workflows: ${selectedCol?.name}`
    : isEditing
      ? (selectedCol ? 'Edit Collection' : 'Create Collection')
      : 'Collections';

  return (
    <>
      <Modal open={open} onClose={onClose} title={modalTitle} size="lg">
        <div className="p-5 overflow-auto" style={{ maxHeight: '70vh' }}>
          {isManagingWorkflows ? (
            <div className="space-y-4">
              {/* Back button */}
              <button onClick={handleBackFromWorkflows} className="flex items-center gap-1 text-sm text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark">
                <ArrowLeft className="w-4 h-4" /> Back to collections
              </button>

              {/* Continue on Fail */}
              <div className="p-3 bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={continueOnFail} onChange={(e) => setContinueOnFail(e.target.checked)} className="toggle toggle-sm toggle-primary" />
                  <span className="text-sm font-medium text-text-primary dark:text-text-primary-dark">Continue on Failure (Collection-wide)</span>
                </label>
                <p className="text-xs text-text-muted dark:text-text-muted-dark mt-1">When enabled, execution continues even if a workflow fails</p>
              </div>

              {/* Workflow Order List */}
              <div>
                <h3 className="text-sm font-semibold text-text-secondary dark:text-text-secondary-dark mb-2">Execution Order (drag to reorder)</h3>
                {workflowOrder.length === 0 ? (
                  <div className="text-center py-8 text-text-muted dark:text-text-muted-dark text-sm">No workflows in this collection yet</div>
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
                            ? 'border-primary bg-primary/5 opacity-50'
                            : 'border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised'
                        } ${!wo.enabled ? 'opacity-60' : ''}`}
                      >
                        <div className="cursor-grab active:cursor-grabbing text-text-muted dark:text-text-muted-dark"><GripVertical className="w-5 h-5" /></div>
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">{index + 1}</div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-text-primary dark:text-text-primary-dark truncate">{wo.workflow?.name || wo.workflowId}</div>
                          <div className="text-xs text-text-muted dark:text-text-muted-dark">{wo.workflow?.nodes?.length || 0} nodes</div>
                        </div>
                        <button onClick={() => toggleWorkflowEnabled(index)} className={`p-1.5 rounded transition-colors ${wo.enabled ? 'text-status-success hover:bg-status-success/10' : 'text-text-muted hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay'}`} title={wo.enabled ? 'Enabled' : 'Disabled'}>
                          {wo.enabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                        </button>
                        <button onClick={() => toggleWorkflowContinueOnFail(index)} className={`px-2 py-1 text-xs rounded transition-colors ${wo.continueOnFail ? 'bg-primary/10 text-primary' : 'bg-status-error/10 text-status-error'}`} title={wo.continueOnFail ? 'Continue on fail' : 'Stop on fail'}>
                          {wo.continueOnFail ? 'Continue' : 'Stop'}
                        </button>
                        <button onClick={() => removeWorkflowFromOrder(index)} className="p-1 text-status-error hover:bg-status-error/10 rounded transition-colors" title="Remove"><X className="w-4 h-4" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add Workflows */}
              {availableWorkflows.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-text-secondary dark:text-text-secondary-dark mb-2">Add More Workflows</h3>
                  <select onChange={(e) => { if (e.target.value) { addWorkflowToOrder(e.target.value); e.target.value = ''; } }} className="select select-bordered select-sm w-full bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark">
                    <option value="">Select a workflow to add...</option>
                    {availableWorkflows.map((w) => <option key={w.workflowId} value={w.workflowId}>{w.name}</option>)}
                  </select>
                </div>
              )}

              {/* Save/Cancel */}
              <div className="flex gap-2 justify-end pt-4 border-t border-border dark:border-border-dark">
                <Button variant="ghost" size="sm" onClick={handleBackFromWorkflows}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={handleSaveWorkflowOrder}>Save Order</Button>
              </div>
            </div>
          ) : isEditing ? (
            <div className="space-y-4">
              {error && (
                <div className="p-3 bg-status-error/5 border border-status-error/20 rounded text-sm text-status-error">{error}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-1">Collection Name *</label>
                <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="input input-bordered input-sm w-full bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark" placeholder="e.g., Staging Tests" />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-1">Description</label>
                <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="textarea textarea-bordered textarea-sm w-full bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark resize-none" placeholder="Optional description..." rows="3" />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-2">Collection Color</label>
                <div className="flex gap-2 flex-wrap">
                  {PRESET_COLORS.map((color) => (
                    <button key={color} onClick={() => setFormData({ ...formData, color })}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${formData.color === color ? 'border-text-primary dark:border-text-primary-dark scale-110' : 'border-border dark:border-border-dark'}`}
                      style={{ backgroundColor: color }} title={color} />
                  ))}
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-4">
                <Button variant="ghost" size="sm" onClick={handleCancel}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={handleSave}>{selectedCol ? 'Update' : 'Create'}</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {collections.length === 0 ? (
                <div className="text-center py-8 text-text-muted dark:text-text-muted-dark">
                  <p>No collections yet</p>
                  <p className="text-sm mt-2">Create one to organize your workflows</p>
                </div>
              ) : (
                collections.map((col) => (
                  <div key={col.collectionId} className="p-3 border border-border dark:border-border-dark rounded hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {col.color && <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: col.color }} />}
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-text-primary dark:text-text-primary-dark truncate">{col.name}</div>
                          {col.description && <div className="text-xs text-text-secondary dark:text-text-secondary-dark truncate">{col.description}</div>}
                          <div className="text-xs text-text-muted dark:text-text-muted-dark mt-1">{col.workflowCount} workflow{col.workflowCount !== 1 ? 's' : ''}</div>
                        </div>
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        <Button variant="ghost" size="xs" onClick={() => handleManageWorkflows(col)} title="Manage workflow order"><ListOrdered className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="xs" onClick={() => handleEdit(col)} title="Edit collection"><Pencil className="w-3.5 h-3.5" /></Button>
                        <button onClick={() => setDeleteTarget(col.collectionId)} className="p-1 text-status-error hover:bg-status-error/10 rounded transition-colors" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  </div>
                ))
              )}

              {/* Footer — New Collection button */}
              <div className="pt-4 border-t border-border dark:border-border-dark">
                <Button variant="primary" size="sm" onClick={handleCreate}><Plus className="w-4 h-4 mr-1" /> New Collection</Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Collection"
        message="Are you sure you want to delete this collection? All workflows will be unassigned. This action cannot be undone."
        confirmLabel="Delete"
        intent="error"
      />
    </>
  );
};

export default CollectionManager;
