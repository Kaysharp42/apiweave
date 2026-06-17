import { useState, useEffect } from 'react';
import { Button } from '../atoms/Button';
import { Input } from '../atoms/Input';
import { TextArea } from '../atoms/TextArea';
import { FormField } from '../molecules/FormField';
import { Card } from '../molecules/Card';
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
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (environment) {
      setForm({
        name: environment.name,
        description: environment.description ?? '',
        swaggerDocUrl: environment.swaggerDocUrl ?? '',
        variables: {},
        allowedWorkspaceIds: environment.allowedWorkspaceIds ?? [],
      });
    } else {
      setForm(EMPTY_FORM);
    }
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
                className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay cursor-pointer transition-colors"
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
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button variant="primary" intent="success" loading={submitting} type="submit">
          {environment ? 'Save Changes' : 'Create Environment'}
        </Button>
      </div>
    </form>
  );
}
