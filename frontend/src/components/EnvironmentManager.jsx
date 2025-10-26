import React, { useState, useEffect } from 'react';

const EnvironmentManager = ({ onClose }) => {
  const [environments, setEnvironments] = useState([]);
  const [selectedEnv, setSelectedEnv] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    variables: {}
  });
  const [newVarKey, setNewVarKey] = useState('');
  const [newVarValue, setNewVarValue] = useState('');

  useEffect(() => {
    fetchEnvironments();
  }, []);

  const fetchEnvironments = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/environments');
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
    setFormData({
      name: '',
      description: '',
      variables: {}
    });
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
        ? `http://localhost:8000/api/environments/${selectedEnv.environmentId}`
        : 'http://localhost:8000/api/environments';
      
      const method = selectedEnv ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        await fetchEnvironments();
        setIsEditing(false);
        setSelectedEnv(null);
        // Notify other components that environments have changed
        window.dispatchEvent(new CustomEvent('environmentsChanged'));
      }
    } catch (error) {
      console.error('Error saving environment:', error);
    }
  };

  const handleDelete = async (envId) => {
    if (!confirm('Are you sure you want to delete this environment?')) {
      return;
    }

    try {
      const response = await fetch(`http://localhost:8000/api/environments/${envId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        await fetchEnvironments();
        if (selectedEnv?.environmentId === envId) {
          setSelectedEnv(null);
          setIsEditing(false);
        }
        // Notify other components that environments have changed
        window.dispatchEvent(new CustomEvent('environmentsChanged'));
      } else {
        const error = await response.json();
        alert(error.detail || 'Failed to delete environment');
      }
    } catch (error) {
      console.error('Error deleting environment:', error);
      alert('Error deleting environment');
    }
  };

  const handleDuplicate = async (envId) => {
    try {
      const response = await fetch(`http://localhost:8000/api/environments/${envId}/duplicate`, {
        method: 'POST'
      });

      if (response.ok) {
        await fetchEnvironments();
        // Notify other components that environments have changed
        window.dispatchEvent(new CustomEvent('environmentsChanged'));
      }
    } catch (error) {
      console.error('Error duplicating environment:', error);
    }
  };

  const handleAddVariable = () => {
    if (newVarKey && newVarValue) {
      setFormData({
        ...formData,
        variables: {
          ...formData.variables,
          [newVarKey]: newVarValue
        }
      });
      setNewVarKey('');
      setNewVarValue('');
    }
  };

  const handleRemoveVariable = (key) => {
    const updatedVars = { ...formData.variables };
    delete updatedVars[key];
    setFormData({
      ...formData,
      variables: updatedVars
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Environment Manager
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Environment List */}
          <div className="w-1/3 border-r border-gray-200 dark:border-gray-700 overflow-auto">
            <div className="p-4">
              <button
                onClick={handleCreate}
                className="w-full px-4 py-2 bg-cyan-900 dark:bg-cyan-800 text-white rounded hover:bg-cyan-950 dark:hover:bg-cyan-900 mb-4"
              >
                + New Environment
              </button>

              <div className="space-y-2">
                {environments.map((env) => (
                  <div
                    key={env.environmentId}
                    className={`p-3 rounded border cursor-pointer transition-colors ${
                      selectedEnv?.environmentId === env.environmentId
                        ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                    onClick={() => !isEditing && handleEdit(env)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 dark:text-white truncate">
                          {env.name}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {Object.keys(env.variables).length} variables
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Environment Details/Editor */}
          <div className="flex-1 overflow-auto p-6">
            {isEditing ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="Development, Staging, Production..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    rows={2}
                    placeholder="Optional description..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Variables
                  </label>

                  {/* Variable List */}
                  <div className="space-y-2 mb-3">
                    {Object.entries(formData.variables).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-700/50 rounded">
                        <span className="font-mono text-sm text-gray-700 dark:text-gray-300 flex-shrink-0">
                          {key}
                        </span>
                        <span className="text-gray-500 dark:text-gray-400">=</span>
                        <span className="font-mono text-sm text-gray-900 dark:text-white flex-1 truncate">
                          {value}
                        </span>
                        <button
                          onClick={() => handleRemoveVariable(key)}
                          className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Add Variable Form */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newVarKey}
                      onChange={(e) => setNewVarKey(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                      placeholder="Variable name (e.g., baseUrl)"
                    />
                    <input
                      type="text"
                      value={newVarValue}
                      onChange={(e) => setNewVarValue(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                      placeholder="Value (e.g., http://localhost:8080)"
                      onKeyPress={(e) => e.key === 'Enter' && handleAddVariable()}
                    />
                    <button
                      onClick={handleAddVariable}
                      className="px-4 py-2 bg-gray-600 dark:bg-gray-500 text-white rounded hover:bg-gray-700 dark:hover:bg-gray-600 text-sm"
                    >
                      Add
                    </button>
                  </div>

                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    Use in workflows: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{'{{env.variableName}}'}</code>
                  </p>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 pt-4">
                  <button
                    onClick={handleSave}
                    className="px-4 py-2 bg-cyan-900 dark:bg-cyan-800 text-white rounded hover:bg-cyan-950 dark:hover:bg-cyan-900"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setIsEditing(false);
                      setSelectedEnv(null);
                    }}
                    className="px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-400 dark:hover:bg-gray-500"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : selectedEnv ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                    {selectedEnv.name}
                  </h3>
                  {selectedEnv.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                      {selectedEnv.description}
                    </p>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Variables ({Object.keys(selectedEnv.variables).length})
                  </h4>
                  <div className="space-y-1">
                    {Object.entries(selectedEnv.variables).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-700/50 rounded">
                        <span className="font-mono text-sm text-gray-700 dark:text-gray-300 flex-shrink-0">
                          {key}
                        </span>
                        <span className="text-gray-500 dark:text-gray-400">=</span>
                        <span className="font-mono text-sm text-gray-900 dark:text-white flex-1 truncate">
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 pt-4">
                  <button
                    onClick={() => handleEdit(selectedEnv)}
                    className="px-4 py-2 bg-cyan-900 dark:bg-cyan-800 text-white rounded hover:bg-cyan-950 dark:hover:bg-cyan-900"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDuplicate(selectedEnv.environmentId)}
                    className="px-4 py-2 bg-gray-600 dark:bg-gray-500 text-white rounded hover:bg-gray-700 dark:hover:bg-gray-600"
                  >
                    Duplicate
                  </button>
                  <button
                    onClick={() => handleDelete(selectedEnv.environmentId)}
                    className="px-4 py-2 bg-red-600 dark:bg-red-700 text-white rounded hover:bg-red-700 dark:hover:bg-red-800"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                <p>Select an environment or create a new one</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EnvironmentManager;
