import React, { useState } from 'react';
import { X, Plus, Trash2, Eye, EyeOff } from 'lucide-react';

const SecretsPanel = ({ environment, onSecretsChange, onClose }) => {
  const [secrets, setSecrets] = useState(environment?.secrets || {});
  const [newSecretKey, setNewSecretKey] = useState('');
  const [newSecretPlaceholder, setNewSecretPlaceholder] = useState('');
  const [visibleSecrets, setVisibleSecrets] = useState(new Set());
  const [saving, setSaving] = useState(false);

  const handleAddSecret = () => {
    if (!newSecretKey.trim()) return;
    
    setSecrets((prev) => ({
      ...prev,
      [newSecretKey]: newSecretPlaceholder
    }));
    setNewSecretKey('');
    setNewSecretPlaceholder('');
  };

  const handleRemoveSecret = (key) => {
    setSecrets((prev) => {
      const updated = { ...prev };
      delete updated[key];
      return updated;
    });
  };

  const toggleVisibility = (key) => {
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

  const handleSave = async () => {
    setSaving(true);
    try {
      if (onSecretsChange) {
        await onSecretsChange(secrets);
      }
      onClose();
    } catch (error) {
      console.error('Error saving secrets:', error);
      alert('Error saving secrets');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-purple-500 to-purple-600 text-white px-6 py-4 flex items-center justify-between border-b border-purple-700">
          <h2 className="text-lg font-semibold">Manage Secrets: {environment?.name}</h2>
          <button
            onClick={onClose}
            className="hover:bg-purple-700 rounded p-1 transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Info */}
          <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded border border-purple-200 dark:border-purple-800">
            <p className="text-sm text-purple-700 dark:text-purple-300">
              Secrets are sensitive values (API keys, tokens, passwords) that users must provide when running workflows. They are stored in browser session memory only, never persisted.
            </p>
          </div>

          {/* Existing Secrets */}
          {Object.keys(secrets).length > 0 && (
            <div className="space-y-3">
              <h3 className="font-semibold text-gray-900 dark:text-white">Secrets</h3>
              <div className="space-y-2">
                {Object.entries(secrets).map(([key, placeholder]) => (
                  <div key={key} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600">
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-sm text-gray-900 dark:text-white break-all">{key}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Placeholder: {placeholder || '(none)'}</p>
                    </div>
                    <button
                      onClick={() => handleRemoveSecret(key)}
                      className="p-2 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/20 rounded transition-colors flex-shrink-0"
                      title="Remove secret"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add New Secret */}
          <div className="space-y-3 p-4 bg-gray-50 dark:bg-gray-700/50 rounded border border-gray-200 dark:border-gray-600">
            <h3 className="font-semibold text-gray-900 dark:text-white">Add New Secret</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Secret Name
                </label>
                <input
                  type="text"
                  value={newSecretKey}
                  onChange={(e) => setNewSecretKey(e.target.value)}
                  placeholder="e.g., API_KEY, AUTH_TOKEN"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Placeholder Text (optional)
                </label>
                <input
                  type="text"
                  value={newSecretPlaceholder}
                  onChange={(e) => setNewSecretPlaceholder(e.target.value)}
                  placeholder="e.g., Paste your API key here"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <button
                onClick={handleAddSecret}
                disabled={!newSecretKey.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
              >
                <Plus className="w-4 h-4" />
                Add Secret
              </button>
            </div>
          </div>

          {/* Usage Example */}
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
            <p className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-2">Usage in HTTP Requests:</p>
            <p className="text-xs font-mono text-blue-700 dark:text-blue-300 bg-white dark:bg-black/20 p-2 rounded">
              {Object.keys(secrets).length > 0
                ? `{"{{"}{Object.keys(secrets)[0]}{"}}"}}`
                : `{{"{{"}}secretName{{"}}"}}`}
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
            disabled={saving}
            className="flex-1 px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SecretsPanel;
