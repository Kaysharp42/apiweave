import React, { useState, useEffect } from 'react';
import { X, Lock, AlertCircle } from 'lucide-react';
import API_BASE_URL from '../utils/api';

const SecretsPrompt = ({ environment, onClose, onSecretsProvided }) => {
  const [secrets, setSecrets] = useState({});
  const [visibleSecrets, setVisibleSecrets] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [allFilled, setAllFilled] = useState(false);

  useEffect(() => {
    if (!environment?.secrets) return;

    // Initialize secrets object with empty values
    const secretsObj = {};
    Object.keys(environment.secrets).forEach((key) => {
      secretsObj[key] = sessionStorage.getItem(`secret_${key}`) || '';
    });
    setSecrets(secretsObj);
  }, [environment]);

  // Check if all secrets are filled
  useEffect(() => {
    if (!environment?.secrets) return;
    const secretKeys = Object.keys(environment.secrets);
    const filled = secretKeys.length > 0 && secretKeys.every((key) => secrets[key]?.trim());
    setAllFilled(filled);
  }, [secrets, environment?.secrets]);

  const handleSecretChange = (key, value) => {
    setSecrets((prev) => ({ ...prev, [key]: value }));
  };

  const toggleSecretVisibility = (key) => {
    setVisibleSecrets((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  const handleSave = () => {
    setSaving(true);
    try {
      // Store secrets in sessionStorage (never persisted to server)
      Object.entries(secrets).forEach(([key, value]) => {
        sessionStorage.setItem(`secret_${key}`, value);
      });
      
      // Notify parent that secrets are ready
      if (onSecretsProvided) {
        onSecretsProvided(secrets);
      }
      
      onClose();
    } catch (error) {
      console.error('Error saving secrets:', error);
      alert('Error saving secrets');
    } finally {
      setSaving(false);
    }
  };

  if (!environment?.secrets || Object.keys(environment.secrets).length === 0) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-blue-600 text-white px-6 py-4 flex items-center justify-between border-b border-blue-700">
          <div className="flex items-center gap-3">
            <Lock className="w-5 h-5" />
            <h2 className="text-lg font-semibold">Environment Secrets Required</h2>
          </div>
          <button
            onClick={onClose}
            className="hover:bg-blue-700 rounded p-1 transition-colors"
            title="Cancel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Info */}
          <div className="flex gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
            <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-blue-700 dark:text-blue-300">
              The environment <strong>{environment.name}</strong> requires secrets to be provided. These will be stored in your browser session only.
            </p>
          </div>

          {/* Secret Inputs */}
          <div className="space-y-3">
            {Object.entries(environment.secrets).map(([key, placeholder]) => (
              <div key={key} className="space-y-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {key}
                </label>
                <div className="flex gap-2">
                  <input
                    type={visibleSecrets.has(key) ? 'text' : 'password'}
                    value={secrets[key] || ''}
                    onChange={(e) => handleSecretChange(key, e.target.value)}
                    placeholder={placeholder || `Enter ${key}`}
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => toggleSecretVisibility(key)}
                    className="px-3 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded border border-gray-300 dark:border-gray-600 transition-colors"
                    title={visibleSecrets.has(key) ? 'Hide' : 'Show'}
                  >
                    {visibleSecrets.has(key) ? '👁' : '👁‍🗨'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Warning */}
          <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded border border-yellow-200 dark:border-yellow-800">
            <p className="text-xs text-yellow-700 dark:text-yellow-300">
              <strong>Note:</strong> Secrets are stored in browser session storage only and will be cleared when you close the browser.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 px-6 py-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!allFilled || saving}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {saving ? 'Saving...' : 'Save Secrets'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SecretsPrompt;
