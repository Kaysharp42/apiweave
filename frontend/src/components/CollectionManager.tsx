import { useState, useEffect, useCallback, type ChangeEvent, type DragEvent } from 'react';
import { toast } from 'sonner';
import { Trash2, Plus, X, GripVertical, Eye, EyeOff, ArrowLeft, Pencil, ListOrdered } from 'lucide-react';
import API_BASE_URL from '../utils/api';
import { Modal } from './molecules/Modal';
import { ConfirmDialog } from './molecules/ConfirmDialog';
import { Button } from './atoms/Button';
import { IconButton } from './atoms/IconButton';
import { Input } from './atoms/Input';
import { TextArea } from './atoms/TextArea';
import { Toggle } from './atoms/Toggle';
import useSidebarStore from '../stores/SidebarStore';
import { DefaultCollectionColor, PresetCollectionColors } from '../constants/CollectionColors';
import type { Collection } from '../types/Collection';
import type { Workflow } from '../types/Workflow';
import { authenticatedFetch } from '../utils/authenticatedApi';

interface ExtendedCollection extends Collection {
  color?: string;
  workflowOrder?: Array<{ workflowId: string; order: number; enabled: boolean; continueOnFail: boolean }>;
  continueOnFail?: boolean;
  workflowCount?: number;
}

interface WorkflowOrderItem {
  workflowId: string;
  order: number;
  enabled: boolean;
  continueOnFail: boolean;
  workflow: Workflow | undefined;
}

interface CollectionFormData {
  name: string;
  description: string;
  color: string;
}

interface CollectionManagerState {
  collections: ExtendedCollection[];
  workflows: Workflow[];
  selectedCol: ExtendedCollection | null;
  isEditing: boolean;
  isManagingWorkflows: boolean;
  workflowOrder: WorkflowOrderItem[];
  draggedIndex: number | null;
  continueOnFail: boolean;
  formData: CollectionFormData;
  error: string;
  deleteTarget: string | null;
}

const createInitialState = (): CollectionManagerState => ({
  collections: [],
  workflows: [],
  selectedCol: null,
  isEditing: false,
  isManagingWorkflows: false,
  workflowOrder: [],
  draggedIndex: null,
  continueOnFail: true,
  formData: { name: '', description: '', color: DefaultCollectionColor },
  error: '',
  deleteTarget: null,
});

interface CollectionManagerProps {
  open: boolean;
  onClose: () => void;
}

export function CollectionManager({ open, onClose }: CollectionManagerProps) {
  const [state, setState] = useState<CollectionManagerState>(() => createInitialState());

  const {
    collections,
    workflows,
    selectedCol,
    isEditing,
    isManagingWorkflows,
    workflowOrder,
    draggedIndex,
    continueOnFail,
    formData,
    error,
    deleteTarget,
  } = state;

  const fetchWorkflows = useCallback(async (): Promise<Workflow[]> => {
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/api/workflows`);
      if (response.ok) {
        const data: unknown = await response.json();
        const workflowArray: Workflow[] = Array.isArray(data) ? data : (data as { workflows: Workflow[] }).workflows || [];
        return workflowArray;
      }
    } catch (err: unknown) {
      console.error('Error fetching workflows:', err);
    }
    return [];
  }, []);

  const fetchCollections = useCallback(async (): Promise<ExtendedCollection[]> => {
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/api/collections`);
      if (response.ok) {
        const data: ExtendedCollection[] = await response.json();
        return data;
      }
    } catch (err: unknown) {
      console.error('Error fetching collections:', err);
    }
    return [];
  }, []);

  useEffect(() => {
    (async () => {
      const [nextCollections, nextWorkflows] = await Promise.all([fetchCollections(), fetchWorkflows()]);
      setState((prev) => ({ ...prev, collections: nextCollections, workflows: nextWorkflows }));
    })();
  }, [fetchCollections, fetchWorkflows]);

  const resetEditingState = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isEditing: false,
      selectedCol: null,
      error: '',
    }));
  }, []);

  const resetManageState = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isManagingWorkflows: false,
      selectedCol: null,
      workflowOrder: [],
    }));
  }, []);

  const updateFormData = useCallback((patch: Partial<CollectionFormData>) => {
    setState((prev) => ({
      ...prev,
      formData: { ...prev.formData, ...patch },
    }));
  }, []);

  const handleCreate = () => {
    setState((prev) => ({
      ...prev,
      isEditing: true,
      selectedCol: null,
      formData: { name: '', description: '', color: DefaultCollectionColor },
      error: '',
    }));
  };

  const handleEdit = (col: ExtendedCollection) => {
    setState((prev) => ({
      ...prev,
      isEditing: true,
      selectedCol: col,
      formData: { name: col.name, description: col.description || '', color: col.color || DefaultCollectionColor },
      error: '',
    }));
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      setState((prev) => ({ ...prev, error: 'Collection name is required' }));
      return;
    }
    try {
      const url = selectedCol
        ? `${API_BASE_URL}/api/collections/${selectedCol.collectionId}`
        : `${API_BASE_URL}/api/collections`;
      const method = selectedCol ? 'PUT' : 'POST';

      const response = await authenticatedFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        toast.success(selectedCol ? 'Collection updated' : 'Collection created');
        const nextCollections = await fetchCollections();
        setState((prev) => ({
          ...prev,
          collections: nextCollections,
          isEditing: false,
          selectedCol: null,
          error: '',
        }));
        useSidebarStore.getState().signalCollectionsRefresh();
      } else {
        const errorData: { detail?: string } = await response.json();
        setState((prev) => ({ ...prev, error: errorData.detail || 'Failed to save collection' }));
      }
    } catch (err: unknown) {
      console.error('Error saving collection:', err);
      setState((prev) => ({ ...prev, error: 'Error saving collection' }));
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/api/collections/${deleteTarget}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        toast.success('Collection deleted');
        const nextCollections = await fetchCollections();
        if (selectedCol?.collectionId === deleteTarget) {
          setState((prev) => ({ ...prev, selectedCol: null, isEditing: false }));
        }
        setState((prev) => ({ ...prev, collections: nextCollections }));
        useSidebarStore.getState().signalCollectionsRefresh();
      } else {
        const errorData: { detail?: string } = await response.json();
        toast.error(errorData.detail || 'Failed to delete collection');
      }
    } catch (err: unknown) {
      console.error('Error deleting collection:', err);
      toast.error('Error deleting collection');
    } finally {
      setState((prev) => ({ ...prev, deleteTarget: null }));
    }
  };

  const handleCancel = () => {
    resetEditingState();
  };

  const handleManageWorkflows = (col: ExtendedCollection) => {
    setState((prev) => ({
      ...prev,
      selectedCol: col,
      isManagingWorkflows: true,
      continueOnFail: col.continueOnFail !== undefined ? col.continueOnFail : true,
    }));
    const collectionWorkflows = workflows.filter(w => w.collectionId === col.collectionId);
    if (col.workflowOrder && col.workflowOrder.length > 0) {
      const sorted = col.workflowOrder.toSorted((a: { order: number }, b: { order: number }) => a.order - b.order);
      const orderedWorkflows: WorkflowOrderItem[] = sorted
        .map((wo: { workflowId: string; order: number; enabled: boolean; continueOnFail: boolean }) => ({ ...wo, workflow: collectionWorkflows.find(w => w.workflowId === wo.workflowId) }))
        .filter((wo: WorkflowOrderItem) => wo.workflow !== undefined);
      setState((prev) => ({ ...prev, workflowOrder: orderedWorkflows }));
    } else {
      setState((prev) => ({ ...prev, workflowOrder: collectionWorkflows.map((workflow, index) => ({
        workflowId: workflow.workflowId, order: index, enabled: true, continueOnFail: true, workflow
      })) }));
    }
  };

  const handleBackFromWorkflows = () => {
    resetManageState();
  };

  const handleSaveWorkflowOrder = async () => {
    if (!selectedCol) return;
    try {
      const orderData = workflowOrder.map((wo, index) => ({
        workflowId: wo.workflowId, order: index, enabled: wo.enabled, continueOnFail: wo.continueOnFail
      }));
      const response = await authenticatedFetch(`${API_BASE_URL}/api/collections/${selectedCol.collectionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowOrder: orderData, continueOnFail })
      });
      if (response.ok) {
        toast.success('Workflow order saved');
        const nextCollections = await fetchCollections();
        setState((prev) => ({
          ...prev,
          collections: nextCollections,
          isManagingWorkflows: false,
          selectedCol: null,
          workflowOrder: [],
        }));
        useSidebarStore.getState().signalCollectionsRefresh();
      } else {
        const errorData: { detail?: string } = await response.json();
        toast.error(errorData.detail || 'Failed to save workflow order');
      }
    } catch (err: unknown) {
      console.error('Error saving workflow order:', err);
      toast.error('Error saving workflow order');
    }
  };

  const handleDragStart = (index: number) => setState((prev) => ({ ...prev, draggedIndex: index }));
  const handleDragOver = (e: DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    const newOrder = [...workflowOrder];
    const draggedItem = newOrder[draggedIndex]!;
    newOrder.splice(draggedIndex, 1);
    newOrder.splice(index, 0, draggedItem);
    setState((prev) => ({ ...prev, workflowOrder: newOrder, draggedIndex: index }));
  };
  const handleDragEnd = () => setState((prev) => ({ ...prev, draggedIndex: null }));

  const toggleWorkflowEnabled = (i: number) => {
    const n = [...workflowOrder];
    const item = n[i]!;
    n[i] = { workflowId: item.workflowId, order: item.order, enabled: !item.enabled, continueOnFail: item.continueOnFail, workflow: item.workflow };
    setState((prev) => ({ ...prev, workflowOrder: n }));
  };

  const toggleWorkflowContinueOnFail = (i: number) => {
    const n = [...workflowOrder];
    const item = n[i]!;
    n[i] = { workflowId: item.workflowId, order: item.order, enabled: item.enabled, continueOnFail: !item.continueOnFail, workflow: item.workflow };
    setState((prev) => ({ ...prev, workflowOrder: n }));
  };

  const removeWorkflowFromOrder = (i: number) => {
    const n = [...workflowOrder];
    n.splice(i, 1);
    setState((prev) => ({ ...prev, workflowOrder: n }));
  };

  const addWorkflowToOrder = (workflowId: string) => {
    const workflow = workflows.find(w => w.workflowId === workflowId);
    if (!workflow) return;
    setState((prev) => ({ ...prev, workflowOrder: [...workflowOrder, { workflowId: workflow.workflowId, order: workflowOrder.length, enabled: true, continueOnFail: true, workflow }] }));
  };

  const handleSelectChange = (e: ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value) {
      addWorkflowToOrder(e.target.value);
      e.target.value = '';
    }
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
      <Modal isOpen={open} onClose={onClose} title={modalTitle} size="lg">
        <div className="p-5 overflow-auto" style={{ maxHeight: '70vh' }}>
          {isManagingWorkflows ? (
            <div className="space-y-4">
              <Button variant="ghost" size="sm" onClick={handleBackFromWorkflows} className="flex items-center gap-1 text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark">
                <ArrowLeft className="w-4 h-4" /> Back to collections
              </Button>

              <div className="p-3 bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded">
                <div className="flex items-center gap-2 cursor-pointer">
          <Toggle checked={continueOnFail} onChange={(e) => setState((prev) => ({ ...prev, continueOnFail: e.target.checked }))} variant="primary" size="sm" />
                  <span className="text-sm font-medium text-text-primary dark:text-text-primary-dark">Continue on Failure (Collection-wide)</span>
                </div>
                <p className="text-xs text-text-muted dark:text-text-muted-dark mt-1">When enabled, execution continues even if a workflow fails</p>
              </div>

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
                        <IconButton
                          variant="ghost"
                          size="xs"
                          onClick={() => toggleWorkflowEnabled(index)}
                          className={wo.enabled ? 'text-status-success hover:bg-status-success/10' : 'text-text-muted hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay'}
                          tooltip={wo.enabled ? 'Enabled' : 'Disabled'}
                        >
                          {wo.enabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                        </IconButton>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => toggleWorkflowContinueOnFail(index)}
                          className={wo.continueOnFail ? 'bg-primary/10 text-primary' : 'bg-status-error/10 text-status-error'}
                          title={wo.continueOnFail ? 'Continue on fail' : 'Stop on fail'}
                        >
                          {wo.continueOnFail ? 'Continue' : 'Stop'}
                        </Button>
                        <IconButton
                          variant="ghost"
                          size="xs"
                          onClick={() => removeWorkflowFromOrder(index)}
                          className="text-status-error hover:bg-status-error/10"
                          tooltip="Remove"
                        >
                          <X className="w-4 h-4" />
                        </IconButton>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {availableWorkflows.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-text-secondary dark:text-text-secondary-dark mb-2">Add More Workflows</h3>
                  <select
                    onChange={handleSelectChange}
                    className="w-full rounded border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Select a workflow to add…</option>
                    {availableWorkflows.map((w) => <option key={w.workflowId} value={w.workflowId}>{w.name}</option>)}
                  </select>
                </div>
              )}

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
                <label htmlFor="collection-name" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-1">Collection Name *</label>
                  <Input
                    id="collection-name"
                    type="text"
                    value={formData.name}
                    onChange={(e) => updateFormData({ name: e.target.value })}
                  size="sm"
                  className="w-full bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark"
                  placeholder="e.g., Staging Tests"
                />
              </div>
              <div>
                <label htmlFor="collection-description" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-1">Description</label>
                  <TextArea
                    id="collection-description"
                    value={formData.description}
                    onChange={(e) => updateFormData({ description: e.target.value })}
                  size="sm"
                  className="w-full bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark resize-none"
                  placeholder="Optional description..."
                  rows={3}
                />
              </div>
              <div>
                <div className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-2">Collection Color</div>
                <div className="flex gap-2 flex-wrap">
                  {PresetCollectionColors.map((color) => (
                    <button
                      type="button"
                      key={color}
                      onClick={() => updateFormData({ color })}
                      className={`w-8 h-8 rounded-full border-2 transition-all p-0 ${formData.color === color ? 'border-text-primary dark:border-text-primary-dark scale-110' : 'border-border dark:border-border-dark'}`}
                      style={{ backgroundColor: color }}
                      title={color}
                      aria-label={`Select color ${color}`}
                    />
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
                        <IconButton
                          variant="ghost"
                          size="xs"
                          onClick={() => setState((prev) => ({ ...prev, deleteTarget: col.collectionId }))}
                          className="text-status-error hover:bg-status-error/10"
                          tooltip="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </IconButton>
                      </div>
                    </div>
                  </div>
                ))
              )}

              <div className="pt-4 border-t border-border dark:border-border-dark">
                <Button variant="primary" size="sm" onClick={handleCreate}><Plus className="w-4 h-4 mr-1" /> New Collection</Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setState((prev) => ({ ...prev, deleteTarget: null }))}
        onConfirm={handleDeleteConfirm}
        title="Delete Collection"
        message="Are you sure you want to delete this collection? All workflows will be unassigned. This action cannot be undone."
        confirmLabel="Delete"
        intent="error"
      />
    </>
  );
}

export default CollectionManager;
