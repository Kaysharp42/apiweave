import { useState, useEffect, useCallback, useReducer } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Copy, Pencil, Lock, X, Link2, Globe } from 'lucide-react';
import API_BASE_URL from '../utils/api';
import { Modal } from './molecules/Modal';
import { ConfirmDialog } from './molecules/ConfirmDialog';
import { EmptyState } from './molecules/EmptyState';
import { Button } from './atoms/Button';
import { IconButton } from './atoms/IconButton';
import { Input } from './atoms/Input';
import { TextArea } from './atoms/TextArea';
import SecretsPanel from './SecretsPanel';
import useSidebarStore from '../stores/SidebarStore';
import type { Environment } from '../types';
import { authenticatedFetch } from '../utils/authenticatedApi';
import type { EnvironmentManagerProps } from '../types/EnvironmentManagerProps';
import type { EnvironmentFormData } from '../types/EnvironmentFormData';
import type { EnvironmentListItem } from '../types/EnvironmentListItem';
import type { EnvironmentManagerState } from '../types/EnvironmentManagerState';
import type { EnvironmentManagerAction } from '../types/EnvironmentManagerAction';

const initialEnvironmentFormData: EnvironmentFormData = {
  name: '',
  description: '',
  swaggerDocUrl: '',
  variables: {},
};

const initialEnvironmentManagerState: EnvironmentManagerState = {
  selectedEnv: null,
  isEditing: false,
  showSecretsPanel: false,
  deleteTarget: null,
  formData: initialEnvironmentFormData,
  newVarKey: '',
  newVarValue: '',
};

function environmentManagerReducer(
  state: EnvironmentManagerState,
  action: EnvironmentManagerAction,
): EnvironmentManagerState {
  switch (action.type) {
    case 'select':
      return { ...state, selectedEnv: action.env };
    case 'start-create':
      return {
        ...state,
        isEditing: true,
        selectedEnv: null,
        formData: initialEnvironmentFormData,
        newVarKey: '',
        newVarValue: '',
      };
    case 'start-edit':
      return {
        ...state,
        isEditing: true,
        selectedEnv: action.env,
        formData: {
          name: action.env.name,
          description: action.env.description || '',
          swaggerDocUrl: action.env.swaggerDocUrl || '',
          variables: { ...action.env.variables },
        },
        newVarKey: '',
        newVarValue: '',
      };
    case 'set-form':
      return { ...state, formData: action.formData };
    case 'patch-form':
      return { ...state, formData: { ...state.formData, ...action.patch } };
    case 'set-new-var-key':
      return { ...state, newVarKey: action.value };
    case 'set-new-var-value':
      return { ...state, newVarValue: action.value };
    case 'open-secrets':
      return { ...state, showSecretsPanel: true };
    case 'close-secrets':
      return { ...state, showSecretsPanel: false };
    case 'set-delete-target':
      return { ...state, deleteTarget: action.value };
    case 'reset-editor':
      return {
        ...state,
        isEditing: false,
        selectedEnv: null,
        formData: initialEnvironmentFormData,
        newVarKey: '',
        newVarValue: '',
      };
    default:
      return state;
  }
}

export function EnvironmentManager({ open, onClose }: EnvironmentManagerProps) {
  const [environments, setEnvironments] = useState<EnvironmentListItem[]>([]);
  const [state, dispatch] = useReducer(environmentManagerReducer, initialEnvironmentManagerState);

  const fetchEnvironments = useCallback(async (): Promise<void> => {
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/api/environments`);
      if (response.ok) {
        const data = await response.json() as EnvironmentListItem[];
        setEnvironments(data);
      }
    } catch (error: unknown) {
      console.error('Error fetching environments:', error);
    }
  }, []);

  useEffect(() => {
    fetchEnvironments();
  }, [fetchEnvironments]);

  const handleCreate = (): void => {
    dispatch({ type: 'start-create' });
  };

  const handleEdit = (env: EnvironmentListItem): void => {
    dispatch({ type: 'start-edit', env });
  };

  const handleSave = async (): Promise<void> => {
    try {
      const url = state.selectedEnv
        ? `${API_BASE_URL}/api/environments/${state.selectedEnv.environmentId}`
        : `${API_BASE_URL}/api/environments`;
      const method = state.selectedEnv ? 'PUT' : 'POST';

      const response = await authenticatedFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.formData)
      });

      if (response.ok) {
        toast.success(state.selectedEnv ? 'Environment updated' : 'Environment created');
        await fetchEnvironments();
        dispatch({ type: 'reset-editor' });
        useSidebarStore.getState().signalEnvironmentsRefresh();
      }
    } catch (error: unknown) {
      console.error('Error saving environment:', error);
      toast.error('Failed to save environment');
    }
  };

  const handleDeleteConfirm = async (): Promise<void> => {
    if (!state.deleteTarget) return;
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/api/environments/${state.deleteTarget}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        toast.success('Environment deleted');
        await fetchEnvironments();
        if (state.selectedEnv?.environmentId === state.deleteTarget) {
          dispatch({ type: 'reset-editor' });
        }
        useSidebarStore.getState().signalEnvironmentsRefresh();
      } else {
        const error = await response.json() as { detail?: string };
        toast.error(error.detail || 'Failed to delete environment');
      }
    } catch (error: unknown) {
      console.error('Error deleting environment:', error);
      toast.error('Error deleting environment');
    } finally {
      dispatch({ type: 'set-delete-target', value: null });
    }
  };

  const handleDuplicate = async (envId: string): Promise<void> => {
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/api/environments/${envId}/duplicate`, {
        method: 'POST'
      });

      if (response.ok) {
        toast.success('Environment duplicated');
        await fetchEnvironments();
        useSidebarStore.getState().signalEnvironmentsRefresh();
      }
    } catch (error: unknown) {
      console.error('Error duplicating environment:', error);
      toast.error('Failed to duplicate environment');
    }
  };

  const handleAddVariable = (): void => {
    if (state.newVarKey && state.newVarValue) {
      dispatch({
        type: 'patch-form',
        patch: {
          variables: { ...state.formData.variables, [state.newVarKey]: state.newVarValue },
        },
      });
      dispatch({ type: 'set-new-var-key', value: '' });
      dispatch({ type: 'set-new-var-value', value: '' });
    }
  };

  const handleRemoveVariable = (key: string): void => {
    const updatedVars = { ...state.formData.variables };
    delete updatedVars[key];
    dispatch({ type: 'patch-form', patch: { variables: updatedVars } });
  };

  const handleSecretsChange = async (secrets: Record<string, string>): Promise<void> => {
    if (!state.selectedEnv) return;
    try {
      const url = `${API_BASE_URL}/api/environments/${state.selectedEnv.environmentId}`;
      const response = await authenticatedFetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...state.formData, secrets })
      });

      if (response.ok) {
        toast.success('Secrets updated');
        await fetchEnvironments();
        dispatch({ type: 'close-secrets' });
        useSidebarStore.getState().signalEnvironmentsRefresh();
      }
    } catch (error: unknown) {
      console.error('Error updating secrets:', error);
      toast.error('Failed to update secrets');
    }
  };

  return (
    <>
      <Modal isOpen={open} onClose={onClose} title="Environment Manager" size="lg">
        <div className="flex h-[70vh]">
          {/* Environment List */}
          <div className="w-1/3 border-r border-border dark:border-border-dark overflow-auto">
            <div className="p-4">
              <Button variant="primary" size="sm" className="w-full mb-4" onClick={handleCreate}>
                <Plus className="w-4 h-4 mr-1" /> New Environment
              </Button>

              <div className="space-y-2">
                {environments.length === 0 ? (
                  <EmptyState
                    icon={<Globe className="w-10 h-10 text-text-muted dark:text-text-muted-dark" strokeWidth={1.5} />}
                    title="No environments"
                    description="Create an environment to manage variables and secrets."
                  />
                ) : (
                  environments.map((env) => (
                    <button
                      type="button"
                      key={env.environmentId}
                      className={`w-full text-left p-3 rounded border cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] ${
                        state.selectedEnv?.environmentId === env.environmentId
                          ? 'border-primary bg-primary/5 dark:border-primary dark:bg-primary/10'
                          : 'border-border dark:border-border-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay'
                      }`}
                      onClick={() => handleEdit(env)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-text-primary dark:text-text-primary-dark truncate">
                            {env.name}
                          </div>
                          <div className="text-xs text-text-muted dark:text-text-muted-dark mt-0.5">
                            {Object.keys(env.variables).length} variables
                            {env.swaggerDocUrl && (
                              <span className="ml-2 inline-flex items-center gap-1">
                                <Link2 className="w-3 h-3 inline" /> Swagger
                              </span>
                            )}
                            {env.secrets && Object.keys(env.secrets).length > 0 && (
                              <span className="ml-2">
                                <Lock className="w-3 h-3 inline" /> {Object.keys(env.secrets).length} secrets
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Environment Details / Editor */}
          <div className="flex-1 overflow-auto p-5">
            {state.isEditing ? (
              <div className="space-y-4">
                <div>
                  <label htmlFor="environment-name" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-1">
                    Name
                  </label>
                  <Input
                    id="environment-name"
                    type="text"
                    value={state.formData.name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => dispatch({ type: 'patch-form', patch: { name: e.target.value } })}
                    size="sm"
                    className="w-full bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark"
                    placeholder="Development, Staging, Production..."
                  />
                </div>

                <div>
                  <label htmlFor="environment-description" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-1">
                    Description
                  </label>
                  <TextArea
                    id="environment-description"
                    value={state.formData.description}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => dispatch({ type: 'patch-form', patch: { description: e.target.value } })}
                    size="sm"
                    className="w-full bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark"
                    rows={2}
                    placeholder="Optional description..."
                  />
                </div>

                <div>
                  <label htmlFor="environment-swagger-url" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-1">
                    Swagger / OpenAPI URL
                  </label>
                  <Input
                    id="environment-swagger-url"
                    type="url"
                    value={state.formData.swaggerDocUrl}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => dispatch({ type: 'patch-form', patch: { swaggerDocUrl: e.target.value } })}
                    size="sm"
                    className="w-full bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark"
                    placeholder="https://api.example.com/webjars/swagger-ui/index.html"
                  />
                  <p className="text-xs text-text-muted dark:text-text-muted-dark mt-1">
                    Supports direct spec URLs and Swagger UI landing URLs. For Swagger UI, APIWeave discovers all definitions automatically.
                  </p>
                </div>

                  <div>
                    <div className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-2">
                      Variables
                    </div>

                  {/* Variable List */}
                  <div className="space-y-2 mb-3">
                    {Object.entries(state.formData.variables).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2 p-2 bg-surface-overlay dark:bg-surface-dark-overlay rounded">
                        <span className="font-mono text-sm text-text-secondary dark:text-text-secondary-dark flex-shrink-0">{key}</span>
                        <span className="text-text-muted dark:text-text-muted-dark">=</span>
                        <span className="font-mono text-sm text-text-primary dark:text-text-primary-dark flex-1 truncate">{value}</span>
                        <IconButton
                          onClick={() => handleRemoveVariable(key)}
                          variant="error"
                          size="xs"
                          tooltip="Remove variable"
                        >
                          <X className="w-4 h-4" />
                        </IconButton>
                      </div>
                    ))}
                  </div>

                  {/* Add Variable */}
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      value={state.newVarKey}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => dispatch({ type: 'set-new-var-key', value: e.target.value })}
                      size="sm"
                      className="flex-1 bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark"
                      placeholder="Variable name"
                    />
                    <Input
                      type="text"
                      value={state.newVarValue}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => dispatch({ type: 'set-new-var-value', value: e.target.value })}
                      size="sm"
                      className="flex-1 bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark"
                      placeholder="Value"
                      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleAddVariable()}
                    />
                    <Button variant="ghost" size="sm" onClick={handleAddVariable}>Add</Button>
                  </div>

                  <p className="text-xs text-text-muted dark:text-text-muted-dark mt-2">
                    Use in workflows: <code className="bg-surface-overlay dark:bg-surface-dark-overlay px-1 rounded">{'{{env.variableName}}'}</code>
                  </p>
                </div>

                {/* Secrets Section */}
                {state.selectedEnv && (
                  <div className="pt-4 border-t border-border dark:border-border-dark">
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">
                        Secrets ({Object.keys(state.selectedEnv.secrets || {}).length})
                      </label>
                      <Button variant="secondary" size="xs" onClick={() => dispatch({ type: 'open-secrets' })}>
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
                  <Button variant="ghost" size="sm" onClick={() => dispatch({ type: 'reset-editor' })}>Cancel</Button>
                </div>
              </div>
            ) : state.selectedEnv ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-text-primary dark:text-text-primary-dark mb-2">
                    {state.selectedEnv.name}
                  </h3>
                  {state.selectedEnv.description && (
                    <p className="text-sm text-text-secondary dark:text-text-secondary-dark mb-4">
                      {state.selectedEnv.description}
                    </p>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-2">
                    Variables ({Object.keys(state.selectedEnv.variables).length})
                  </h4>
                  <div className="space-y-1">
                    {Object.entries(state.selectedEnv.variables).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2 p-2 bg-surface-overlay dark:bg-surface-dark-overlay rounded">
                        <span className="font-mono text-sm text-text-secondary dark:text-text-secondary-dark flex-shrink-0">{key}</span>
                        <span className="text-text-muted dark:text-text-muted-dark">=</span>
                        <span className="font-mono text-sm text-text-primary dark:text-text-primary-dark flex-1 truncate">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                  {state.selectedEnv.swaggerDocUrl && (
                  <div>
                    <h4 className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-2">
                      Swagger / OpenAPI URL
                    </h4>
                    <a
                      href={state.selectedEnv.swaggerDocUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-primary dark:text-primary-dark hover:underline break-all inline-flex items-center gap-1"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      {state.selectedEnv.swaggerDocUrl}
                    </a>
                  </div>
                )}

                {/* Secrets */}
                {state.selectedEnv.secrets && Object.keys(state.selectedEnv.secrets).length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-2">
                      Secrets ({Object.keys(state.selectedEnv.secrets).length})
                    </h4>
                    <div className="space-y-1">
                      {Object.entries(state.selectedEnv.secrets).map(([key]) => (
                        <div key={key} className="flex items-center gap-2 p-2 bg-[var(--aw-status-info)]/5 dark:bg-[var(--aw-status-info)]/10 rounded border border-[var(--aw-status-info)]/20 dark:border-[var(--aw-status-info)]/30">
                          <Lock className="w-3.5 h-3.5 text-[var(--aw-status-info)] flex-shrink-0" />
                          <span className="font-mono text-sm text-text-primary dark:text-text-primary-dark min-w-0 truncate">{key}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-2 pt-4 flex-wrap">
                  <Button variant="primary" size="sm" onClick={() => handleEdit(state.selectedEnv!)}>
                    <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => dispatch({ type: 'open-secrets' })}>
                    <Lock className="w-3.5 h-3.5 mr-1" /> Manage Secrets
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDuplicate(state.selectedEnv!.environmentId)}>
                    <Copy className="w-3.5 h-3.5 mr-1" /> Duplicate
                  </Button>
                  <Button variant="primary" size="sm" intent="error" onClick={() => dispatch({ type: 'set-delete-target', value: state.selectedEnv!.environmentId })}>
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
        open={!!state.deleteTarget}
        onClose={() => dispatch({ type: 'set-delete-target', value: null })}
        onConfirm={handleDeleteConfirm}
        title="Delete Environment"
        message="Are you sure you want to delete this environment? This action cannot be undone."
        confirmLabel="Delete"
        intent="error"
      />

      {/* Secrets Panel Modal */}
      <SecretsPanel
        key={state.selectedEnv?.environmentId ?? 'no-environment'}
        isOpen={state.showSecretsPanel && !!state.selectedEnv}
        environment={state.selectedEnv as Environment | null}
        onSecretsChange={handleSecretsChange}
        onClose={() => dispatch({ type: 'close-secrets' })}
      />
    </>
  );
}

export default EnvironmentManager;
