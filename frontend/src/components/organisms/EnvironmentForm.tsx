import { useState, useEffect } from 'react';
import { Lock, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../atoms/Button';
import { IconButton } from '../atoms/IconButton';
import { Input } from '../atoms/Input';
import { TextArea } from '../atoms/TextArea';
import { FormField } from '../molecules/FormField';
import { Card } from '../molecules/Card';
import SecretsPanel from '../SecretsPanel';
import type { EnvironmentFormProps, EnvironmentFormData } from '../../types';

const EMPTY_FORM: EnvironmentFormData = {
  name: '',
  description: '',
  swaggerDocUrl: '',
  variables: {},
  allowedWorkspaceIds: [],
};

export function EnvironmentForm({
  environment,
  onSubmit,
  onCancel,
  submitting = false,
  availableWorkspaces = [],
  showAllowedWorkspaces = false,
  className = '',
}: EnvironmentFormProps) {
  const [form, setForm] = useState<EnvironmentFormData>(EMPTY_FORM);
  const [newVarKey, setNewVarKey] = useState<string>('');
  const [newVarValue, setNewVarValue] = useState<string>('');
  const [showSecretsPanel, setShowSecretsPanel] = useState<boolean>(false);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (environment) {
      setForm({
        name: environment.name,
        description: environment.description ?? '',
        swaggerDocUrl: environment.swaggerDocUrl ?? '',
        variables: { ...environment.variables },
        allowedWorkspaceIds: environment.allowedWorkspaceIds ?? [],
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setNewVarKey('');
    setNewVarValue('');
    setShowSecretsPanel(false);
  }, [environment]);

  function updateField<K extends keyof EnvironmentFormData>(key: K, value: EnvironmentFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === 'name') setNameError(null);
  }

  function toggleWorkspace(wsId: string) {
    setForm((prev) => {
      const ids = prev.allowedWorkspaceIds ?? [];
      return {
        ...prev,
        allowedWorkspaceIds: ids.includes(wsId)
          ? ids.filter((wid) => wid !== wsId)
          : [...ids, wsId],
      };
    });
  }

  function handleAddVariable() {
    const trimmedKey = newVarKey.trim();
    if (!trimmedKey || !newVarValue) return;

    if (Object.prototype.hasOwnProperty.call(form.variables, trimmedKey)) {
      toast.error('Variable already exists');
      return;
    }

    updateField('variables', {
      ...form.variables,
      [trimmedKey]: newVarValue,
    });
    setNewVarKey('');
    setNewVarValue('');
  }

  function handleRemoveVariable(key: string) {
    setForm((prev) => {
      const updatedVariables = { ...prev.variables };
      delete updatedVariables[key];
      return { ...prev, variables: updatedVariables };
    });
  }

  function validate(): boolean {
    if (!form.name.trim()) {
      setNameError('Name is required');
      return false;
    }
    setNameError(null);
    return true;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    await onSubmit(form);
  }

  return (
    <>
      <form onSubmit={handleSubmit} className={`space-y-4 ${className}`}>
        <Card title={environment ? 'Edit Environment' : 'New Environment'}>
          <div className="space-y-4">
            <FormField label="Name" required error={nameError ?? ''}>
              <Input
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="e.g. Production"
                error={nameError ?? ''}
              />
            </FormField>

            <FormField label="Description" hint="Optional description of this environment">
              <TextArea
                value={form.description}
                onChange={(e) => updateField('description', e.target.value)}
                placeholder="e.g. Production API endpoints"
                rows={2}
              />
            </FormField>

            <FormField label="Swagger Doc URL" hint="Optional OpenAPI spec URL for this environment">
              <Input
                value={form.swaggerDocUrl}
                onChange={(e) => updateField('swaggerDocUrl', e.target.value)}
                placeholder="https://api.example.com/openapi.json"
              />
            </FormField>

            <div>
              <div className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-2">
                Variables
              </div>

              <div className="space-y-2 mb-3">
                {Object.entries(form.variables).map(([key, value]) => (
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

              <div className="flex gap-2">
                <Input
                  type="text"
                  value={newVarKey}
                  onChange={(e) => setNewVarKey(e.target.value)}
                  size="sm"
                  className="flex-1"
                  placeholder="Variable name"
                />
                <Input
                  type="text"
                  value={newVarValue}
                  onChange={(e) => setNewVarValue(e.target.value)}
                  size="sm"
                  className="flex-1"
                  placeholder="Value"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddVariable();
                    }
                  }}
                />
                <Button variant="ghost" size="sm" onClick={handleAddVariable}>Add</Button>
              </div>

              <p className="text-xs text-text-muted dark:text-text-muted-dark mt-2">
                Use in workflows: <code className="bg-surface-overlay dark:bg-surface-dark-overlay px-1 rounded">{'{{env.variableName}}'}</code>
              </p>
            </div>

            {environment && (
              <div className="pt-4 border-t border-border dark:border-border-dark">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">
                    Secrets ({Object.keys(environment.secrets ?? {}).length})
                  </label>
                  <Button variant="outline" size="xs" onClick={() => setShowSecretsPanel(true)}>
                    <Lock className="w-3 h-3 mr-1" /> Manage
                  </Button>
                </div>
                <p className="text-xs text-text-muted dark:text-text-muted-dark">
                  Secrets are sensitive values (API keys, tokens) that users provide when running workflows.
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* Allowed workspaces (org env policy) */}
        {showAllowedWorkspaces && availableWorkspaces.length > 0 && (
          <Card title="Allowed Workspaces">
            <p className="text-xs text-text-secondary dark:text-text-secondary-dark mb-3">
              Select which workspaces can use this organization environment. Leave empty to allow all.
            </p>
            <div className="space-y-1.5">
              {availableWorkspaces.map((ws) => (
                <label
                  key={ws.workspaceId}
                  className="flex items-center gap-2 px-3 py-2 rounded border border-transparent hover:border-border dark:hover:border-border-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    className="checkbox checkbox-primary checkbox-sm"
                    checked={(form.allowedWorkspaceIds ?? []).includes(ws.workspaceId)}
                    onChange={() => toggleWorkspace(ws.workspaceId)}
                  />
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-text-primary dark:text-text-primary-dark">
                      {ws.name}
                    </span>
                    <span className="ml-2 text-xs text-text-muted dark:text-text-muted-dark">
                      /{ws.slug}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </Card>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" intent="success" loading={submitting} type="submit">
            {environment ? 'Save Changes' : 'Create Environment'}
          </Button>
        </div>
      </form>

      <SecretsPanel
        key={environment?.environmentId ?? 'no-environment'}
        isOpen={showSecretsPanel && !!environment}
        environment={environment ?? null}
        onClose={() => setShowSecretsPanel(false)}
      />
    </>
  );
}
