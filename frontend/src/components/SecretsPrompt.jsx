import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Lock, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { Modal } from './molecules';
import { Button } from './atoms';

const SecretsPrompt = ({ open, environment, onClose, onSecretsProvided }) => {
  const [secrets, setSecrets] = useState({});
  const [visibleSecrets, setVisibleSecrets] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [allFilled, setAllFilled] = useState(false);

  useEffect(() => {
    if (!environment?.secrets) return;
    const secretsObj = {};
    Object.keys(environment.secrets).forEach((key) => {
      secretsObj[key] = sessionStorage.getItem(`secret_${key}`) || '';
    });
    setSecrets(secretsObj);
  }, [environment]);

  useEffect(() => {
    if (!environment?.secrets) return;
    const secretKeys = Object.keys(environment.secrets);
    setAllFilled(secretKeys.length > 0 && secretKeys.every((key) => secrets[key]?.trim()));
  }, [secrets, environment?.secrets]);

  const handleSecretChange = (key, value) => {
    setSecrets((prev) => ({ ...prev, [key]: value }));
  };

  const toggleSecretVisibility = (key) => {
    setVisibleSecrets((prev) => {
      const newSet = new Set(prev);
      newSet.has(key) ? newSet.delete(key) : newSet.add(key);
      return newSet;
    });
  };

  const handleSave = () => {
    setSaving(true);
    try {
      Object.entries(secrets).forEach(([key, value]) => {
        sessionStorage.setItem(`secret_${key}`, value);
      });
      onSecretsProvided?.(secrets);
      onClose();
    } catch (error) {
      console.error('Error saving secrets:', error);
      toast.error('Error saving secrets');
    } finally {
      setSaving(false);
    }
  };

  if (!environment?.secrets || Object.keys(environment.secrets).length === 0) {
    return null;
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Environment Secrets Required"
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={!allFilled || saving}>
            <Lock className="w-3.5 h-3.5 mr-1" />
            {saving ? 'Saving...' : 'Save Secrets'}
          </Button>
        </>
      }
    >
      <div className="p-5 space-y-4">
        {/* Info */}
        <div className="flex gap-3 p-3 bg-primary/5 dark:bg-primary/10 rounded border border-primary/20">
          <AlertCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
            The environment <strong>{environment.name}</strong> requires secrets. These are stored in your browser session only.
          </p>
        </div>

        {/* Secret Inputs */}
        <div className="space-y-3">
          {Object.entries(environment.secrets).map(([key, placeholder]) => (
            <div key={key} className="space-y-1">
              <label className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark">
                {key}
              </label>
              <div className="flex gap-2">
                <input
                  type={visibleSecrets.has(key) ? 'text' : 'password'}
                  value={secrets[key] || ''}
                  onChange={(e) => handleSecretChange(key, e.target.value)}
                  placeholder={placeholder || `Enter ${key}`}
                  className="input input-bordered input-sm flex-1 bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark"
                />
                <Button
                  onClick={() => toggleSecretVisibility(key)}
                  variant="ghost"
                  size="sm"
                  className="!p-2 !min-w-0"
                  title={visibleSecrets.has(key) ? 'Hide' : 'Show'}
                >
                  {visibleSecrets.has(key) ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* Warning */}
        <div className="p-3 bg-status-warning/5 rounded border border-status-warning/20">
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
            <strong>Note:</strong> Secrets are stored in browser session storage only and will be cleared when you close the browser.
          </p>
        </div>
      </div>
    </Modal>
  );
};

export default SecretsPrompt;
