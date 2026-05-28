import { useState, useMemo, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from './molecules/Modal';
import { Button } from './atoms/Button';
import type { Environment } from '../types';

export interface SecretsPanelProps {
  isOpen: boolean;
  environment: Environment | null;
  onSecretsChange?: (secrets: Record<string, string>) => Promise<void>;
  onClose: () => void;
}

export default function SecretsPanel({
  isOpen,
  environment,
  onSecretsChange,
  onClose,
}: SecretsPanelProps) {
  const initialSecrets = useMemo<Record<string, string>>(
    () => environment?.secrets ?? {},
    [environment?.secrets],
  );
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [newSecretKey, setNewSecretKey] = useState('');
  const [newSecretPlaceholder, setNewSecretPlaceholder] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSecrets(initialSecrets);
    }
  }, [initialSecrets, isOpen]);

  const handleAddSecret = () => {
    if (!newSecretKey.trim()) return;
    setSecrets((prev) => ({ ...prev, [newSecretKey]: newSecretPlaceholder }));
    setNewSecretKey('');
    setNewSecretPlaceholder('');
  };

  const handleRemoveSecret = (key: string) => {
    setSecrets((prev) => {
      const updated = { ...prev };
      delete updated[key];
      return updated;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (onSecretsChange) await onSecretsChange(secrets);
      onClose();
    } catch {
      toast.error('Error saving secrets');
    } finally {
      setSaving(false);
    }
  };

  const footer = () => (
    <div className="flex gap-3 w-full">
      <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
      <Button onClick={handleSave} disabled={saving} variant="primary" fullWidth>
        {saving ? 'Saving\u2026' : 'Save Changes'}
      </Button>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Manage Secrets: ${environment?.name ?? ''}`} size="md" footer={footer}>
      <div className="space-y-6">
        <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
            Secrets are sensitive values (API keys, tokens, passwords) that users must provide when running workflows. They are stored in browser session memory only, never persisted.
          </p>
        </div>

        {Object.keys(secrets).length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold text-text-primary dark:text-text-primary-dark">Secrets</h3>
            <div className="space-y-2">
              {Object.entries(secrets).map(([key, placeholder]) => (
                <div key={key} className="flex items-center gap-3 p-3 bg-surface-raised dark:bg-surface-dark-raised rounded-lg border border-border dark:border-border-dark">
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm text-text-primary dark:text-text-primary-dark break-all">{key}</p>
                    <p className="text-xs text-text-muted dark:text-text-muted-dark mt-1">Placeholder: {placeholder ?? '(none)'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveSecret(key)}
                    aria-label={`Remove secret ${key}`}
                    className="p-2 text-status-error hover:bg-status-error/10 rounded-lg transition-colors flex-shrink-0"
                    title="Remove secret"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3 p-4 bg-surface-raised dark:bg-surface-dark-raised rounded-lg border border-border dark:border-border-dark">
          <h3 className="font-semibold text-text-primary dark:text-text-primary-dark">Add New Secret</h3>
          <div className="space-y-3">
            <div>
              <label htmlFor="secret-name" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-1">Secret Name</label>
              <input
                id="secret-name"
                type="text"
                value={newSecretKey}
                onChange={(e) => setNewSecretKey(e.target.value)}
                placeholder="e.g., API_KEY, AUTH_TOKEN"
                className="input input-bordered w-full"
              />
            </div>
            <div>
              <label htmlFor="secret-placeholder" className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-1">Placeholder Text (optional)</label>
              <input
                id="secret-placeholder"
                type="text"
                value={newSecretPlaceholder}
                onChange={(e) => setNewSecretPlaceholder(e.target.value)}
                placeholder="e.g., Paste your API key here"
                className="input input-bordered w-full"
              />
            </div>
            <Button
              onClick={handleAddSecret}
              disabled={!newSecretKey.trim()}
              variant="primary"
              size="sm"
              fullWidth
            >
              <Plus className="w-4 h-4" />
              Add Secret
            </Button>
          </div>
        </div>

        <div className="p-4 bg-info/5 rounded-lg border border-info/20">
          <p className="text-sm font-semibold text-text-primary dark:text-text-primary-dark mb-2">Usage in HTTP Requests:</p>
          <p className="text-xs font-mono text-text-secondary dark:text-text-secondary-dark bg-surface-raised dark:bg-surface-dark-raised p-2 rounded">
            {'{{'}
            {Object.keys(secrets).length > 0 ? Object.keys(secrets)[0] : 'secretName'}
            {'}}'}
          </p>
        </div>
      </div>
    </Modal>
  );
}
