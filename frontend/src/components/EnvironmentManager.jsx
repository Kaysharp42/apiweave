import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Copy, Pencil, Lock, X } from 'lucide-react';
import API_BASE_URL from '../utils/api';
import { Modal, ConfirmDialog } from './molecules';
import { Button, Input, TextArea, Badge } from './atoms';
import SecretsPanel from './SecretsPanel';

const EnvironmentManager = ({ open, onClose }) => {
  const [environments, setEnvironments] = useState([]);
  const [selectedEnv, setSelectedEnv] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showSecretsPanel, setShowSecretsPanel] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    variables: {}
  });
  const [newVarKey, setNewVarKey] = useState('');
  const [newVarValue, setNewVarValue] = useState('');

  useEffect(() => {
    if (open) fetchEnvironments();
  }, [open]);

  const fetchEnvironments = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/environments`);
      if (response.ok) {
        const data = await response.json();
        setEnvironments(data);
      }
    } catch (error) {
      console.error('Error fetching environments:', error);
    }
  };

  const handleCreate = () => {
    setIsEditing(true);
    setSelectedEnv(null);
    setFormData({ name: '', description: '', variables: {} });
  };

  const handleEdit = (env) => {
    setIsEditing(true);
    setSelectedEnv(env);
    setFormData({
      name: env.name,
      description: env.description || '',
      variables: { ...env.variables }
    });
  };

  const handleSave = async () => {
    try {
      const url = selectedEnv
        ? `${API_BASE_URL}/api/environments/${selectedEnv.environmentId}`
        : `${API_BASE_URL}/api/environments`;
      const method = selectedEnv ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        toast.success(selectedEnv ? 'Environment updated' : 'Environment created');
        await fetchEnvironments();
        setIsEditing(false);
        setSelectedEnv(null);
        window.dispatchEvent(new CustomEvent('environmentsChanged'));
      }
    } catch (error) {
      console.error('Error saving environment:', error);
      toast.error('Failed to save environment');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/environments/${deleteTarget}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        toast.success('Environment deleted');
        await fetchEnvironments();
        if (selectedEnv?.environmentId === deleteTarget) {
          setSelectedEnv(null);
          setIsEditing(false);
        }
        window.dispatchEvent(new CustomEvent('environmentsChanged'));
      } else {
        const error = await response.json();
        toast.error(error.detail || 'Failed to delete environment');
      }
    } catch (error) {
      console.error('Error deleting environment:', error);
      toast.error('Error deleting environment');
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleDuplicate = async (envId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/environments/${envId}/duplicate`, {
        method: 'POST'
      });

      if (response.ok) {
        toast.success('Environment duplicated');
        await fetchEnvironments();
        window.dispatchEvent(new CustomEvent('environmentsChanged'));
      }
    } catch (error) {
      console.error('Error duplicating environment:', error);
      toast.error('Failed to duplicate environment');
    }
  };

  const handleAddVariable = () => {
    if (newVarKey && newVarValue) {
      setFormData({
        ...formData,
        variables: { ...formData.variables, [newVarKey]: newVarValue }
      });
      setNewVarKey('');
      setNewVarValue('');
    }
  };

  const handleRemoveVariable = (key) => {
    const updatedVars = { ...formData.variables };
    delete updatedVars[key];
    setFormData({ ...formData, variables: updatedVars });
  };

  const handleSecretsChange = async (secrets) => {
    try {
      const url = `${API_BASE_URL}/api/environments/${selectedEnv.environmentId}`;
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, secrets })
      });

      if (response.ok) {
        toast.success('Secrets updated');
        await fetchEnvironments();
        setShowSecretsPanel(false);
        window.dispatchEvent(new CustomEvent('environmentsChanged'));
      }
    } catch (error) {
      console.error('Error updating secrets:', error);
      toast.error('Failed to update secrets');
    }
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="Environment Manager" size="lg">
        <div className="flex h-[70vh]">
          {/* Environment List */}
          <div className="w-1/3 border-r border-border dark:border-border-dark overflow-auto">
            <div className="p-4">
              <Button variant="primary" size="sm" className="w-full mb-4" onClick={handleCreate}>
                <Plus className="w-4 h-4 mr-1" /> New Environment
              </Button>

              <div className="space-y-2">
                {environments.map((env) => (
                  <div
                    key={env.environmentId}
                    className={`p-3 rounded border cursor-pointer transition-colors ${
                      selectedEnv?.environmentId === env.environmentId
                        ? 'border-primary bg-primary/5 dark:border-primary dark:bg-primary/10'
                        : 'border-border dark:border-border-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay'
                    }`}
                    onClick={() => !isEditing && handleEdit(env)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-text-primary dark:text-text-primary-dark truncate">
                          {env.name}
                        </div>
                        <div className="text-xs text-text-muted dark:text-text-muted-dark mt-0.5">
                          {Object.keys(env.variables).length} variables
                          {env.secrets && Object.keys(env.secrets).length > 0 && (
                            <span className="ml-2">
                              <Lock className="w-3 h-3 inline" /> {Object.keys(env.secrets).length} secrets
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Environment Details / Editor */}
          <div className="flex-1 overflow-auto p-5">
            {isEditing ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="input input-bordered input-sm w-full bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark"
                    placeholder="Development, Staging, Production..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-1">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="textarea textarea-bordered textarea-sm w-full bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark"
                    rows={2}
                    placeholder="Optional description..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-2">
                    Variables
                  </label>

                  {/* Variable List */}
                  <div className="space-y-2 mb-3">
                    {Object.entries(formData.variables).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2 p-2 bg-surface-overlay dark:bg-surface-dark-overlay rounded">
                        <span className="font-mono text-sm text-text-secondary dark:text-text-secondary-dark flex-shrink-0">{key}</span>
                        <span className="text-text-muted dark:text-text-muted-dark">=</span>
                        <span className="font-mono text-sm text-text-primary dark:text-text-primary-dark flex-1 truncate">{value}</span>
                        <button
                          onClick={() => handleRemoveVariable(key)}
                          className="p-1 text-status-error hover:bg-status-error/10 rounded transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Add Variable */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newVarKey}
                      onChange={(e) => setNewVarKey(e.target.value)}
                      className="input input-bordered input-sm flex-1 bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark"
                      placeholder="Variable name"
                    />
                    <input
                      type="text"
                      value={newVarValue}
                      onChange={(e) => setNewVarValue(e.target.value)}
                      className="input input-bordered input-sm flex-1 bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark"
                      placeholder="Value"
                      onKeyDown={(e) => e.key === 'Enter' && handleAddVariable()}
                    />
                    <Button variant="ghost" size="sm" onClick={handleAddVariable}>Add</Button>
                  </div>

                  <p className="text-xs text-text-muted dark:text-text-muted-dark mt-2">
                    Use in workflows: <code className="bg-surface-overlay dark:bg-surface-dark-overlay px-1 rounded">{'{{env.variableName}}'}</code>
                  </p>
                </div>

                {/* Secrets Section */}
                {selectedEnv && (
                  <div className="pt-4 border-t border-border dark:border-border-dark">
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">
                        Secrets ({Object.keys(selectedEnv.secrets || {}).length})
                      </label>
                      <Button variant="secondary" size="xs" onClick={() => setShowSecretsPanel(true)}>
                        <Lock className="w-3 h-3 mr-1" /> Manage
                      </Button>
                    </div>
                    <p className="text-xs text-text-muted dark:text-text-muted-dark">
                      Secrets are sensitive values (API keys, tokens) that users provide when running workflows.
                    </p>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-2 pt-4">
                  <Button variant="primary" size="sm" onClick={handleSave}>Save</Button>
                  <Button variant="ghost" size="sm" onClick={() => { setIsEditing(false); setSelectedEnv(null); }}>Cancel</Button>
                </div>
              </div>
            ) : selectedEnv ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-text-primary dark:text-text-primary-dark mb-2">
                    {selectedEnv.name}
                  </h3>
                  {selectedEnv.description && (
                    <p className="text-sm text-text-secondary dark:text-text-secondary-dark mb-4">
                      {selectedEnv.description}
                    </p>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-2">
                    Variables ({Object.keys(selectedEnv.variables).length})
                  </h4>
                  <div className="space-y-1">
                    {Object.entries(selectedEnv.variables).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2 p-2 bg-surface-overlay dark:bg-surface-dark-overlay rounded">
                        <span className="font-mono text-sm text-text-secondary dark:text-text-secondary-dark flex-shrink-0">{key}</span>
                        <span className="text-text-muted dark:text-text-muted-dark">=</span>
                        <span className="font-mono text-sm text-text-primary dark:text-text-primary-dark flex-1 truncate">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Secrets */}
                {selectedEnv.secrets && Object.keys(selectedEnv.secrets).length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-2">
                      Secrets ({Object.keys(selectedEnv.secrets).length})
                    </h4>
                    <div className="space-y-1">
                      {Object.entries(selectedEnv.secrets).map(([key]) => (
                        <div key={key} className="flex items-center gap-2 p-2 bg-purple-50 dark:bg-purple-900/20 rounded border border-purple-200 dark:border-purple-800">
                          <Lock className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 flex-shrink-0" />
                          <span className="font-mono text-sm text-purple-700 dark:text-purple-300">{key}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-2 pt-4 flex-wrap">
                  <Button variant="primary" size="sm" onClick={() => handleEdit(selectedEnv)}>
                    <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setShowSecretsPanel(true)}>
                    <Lock className="w-3.5 h-3.5 mr-1" /> Manage Secrets
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDuplicate(selectedEnv.environmentId)}>
                    <Copy className="w-3.5 h-3.5 mr-1" /> Duplicate
                  </Button>
                  <Button variant="error" size="sm" onClick={() => setDeleteTarget(selectedEnv.environmentId)}>
                    <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-text-muted dark:text-text-muted-dark">
                <p>Select an environment or create a new one</p>
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Environment"
        message="Are you sure you want to delete this environment? This action cannot be undone."
        confirmLabel="Delete"
        intent="error"
      />

      {/* Secrets Panel Modal */}
      {showSecretsPanel && selectedEnv && (
        <SecretsPanel
          environment={selectedEnv}
          onSecretsChange={handleSecretsChange}
          onClose={() => setShowSecretsPanel(false)}
        />
      )}
    </>
  );
};

export default EnvironmentManager;
