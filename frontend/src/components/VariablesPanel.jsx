import React, { useState } from 'react';
import { useWorkflow } from '../contexts/WorkflowContext';

const VariablesPanel = () => {
  const { variables, updateVariable, updateVariables, workflowId } = useWorkflow();
  
  const [showForm, setShowForm] = useState(false);
  const [newVarName, setNewVarName] = useState('');
  const [newVarValue, setNewVarValue] = useState('');
  const [editingVar, setEditingVar] = useState(null);
  const [editValue, setEditValue] = useState('');

  const handleAdd = () => {
    if (newVarName.trim()) {
      updateVariable(newVarName.trim(), newVarValue);
      setNewVarName('');
      setNewVarValue('');
      setShowForm(false);
    }
  };

  const handleDelete = (varName) => {
    // Delete from context
    const updated = { ...variables };
    delete updated[varName];
    updateVariables(updated);
    
    // Emit event for WorkflowCanvas to clean up extractors
    window.dispatchEvent(new CustomEvent('variableDeleted', {
      detail: {
        workflowId,
        deletedVars: [varName]
      }
    }));
  };

  const handleEdit = (varName, value) => {
    updateVariable(varName, value);
    setEditingVar(null);
  };

  return (
    <div className="w-full bg-white dark:bg-gray-800 overflow-y-auto h-full flex flex-col">
      <div className="sticky top-0 bg-slate-50 dark:bg-gray-900 border-b dark:border-gray-700 p-3 z-10">
        <button
          onClick={() => setShowForm(!showForm)}
          className="w-full px-2 py-1 bg-cyan-500 dark:bg-cyan-600 hover:bg-cyan-600 dark:hover:bg-cyan-700 text-white text-xs rounded transition-colors"
        >
          + Add Variable
        </button>
      </div>

      <div className="p-3 space-y-2 flex-1 overflow-y-auto">
        {/* Add Form */}
        {showForm && (
          <div className="p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded space-y-2">
            <input
              type="text"
              placeholder="Variable name"
              className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400 rounded text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500"
              value={newVarName}
              onChange={(e) => setNewVarName(e.target.value)}
            />
            <textarea
              placeholder="Value (can be JSON, text, etc.)"
              className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400 rounded text-xs font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500"
              rows={3}
              value={newVarValue}
              onChange={(e) => setNewVarValue(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                className="flex-1 px-2 py-1 bg-green-500 dark:bg-green-600 hover:bg-green-600 dark:hover:bg-green-700 text-white text-xs font-semibold rounded transition-colors"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setShowForm(false);
                  setNewVarName('');
                  setNewVarValue('');
                }}
                className="flex-1 px-2 py-1 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 text-xs font-semibold rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Variables List */}
        {variables && Object.keys(variables).length > 0 ? (
          <div className="space-y-2">
            {Object.entries(variables).map(([varName, varValue]) => (
              <div
                key={varName}
                className="p-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <code className="text-xs font-semibold text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/30 px-2 py-1 rounded flex-1">
                    {varName}
                  </code>
                  <button
                    onClick={() => {
                      setEditingVar(varName);
                      setEditValue(typeof varValue === 'string' ? varValue : JSON.stringify(varValue));
                    }}
                    className="px-2 py-1 bg-blue-500 dark:bg-blue-600 hover:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs rounded transition-colors"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => handleDelete(varName)}
                    className="px-2 py-1 bg-red-500 dark:bg-red-600 hover:bg-red-600 dark:hover:bg-red-700 text-white text-xs rounded transition-colors"
                  >
                    ✕
                  </button>
                </div>

                {editingVar === varName ? (
                  <div className="space-y-1">
                    <textarea
                      className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-600 dark:text-gray-200 rounded text-xs font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      rows={3}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                    />
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleEdit(varName, editValue)}
                        className="flex-1 px-1.5 py-0.5 bg-green-500 dark:bg-green-600 hover:bg-green-600 dark:hover:bg-green-700 text-white text-xs font-semibold rounded transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingVar(null)}
                        className="flex-1 px-1.5 py-0.5 bg-gray-400 dark:bg-gray-600 hover:bg-gray-500 dark:hover:bg-gray-700 text-white text-xs font-semibold rounded transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-gray-600 dark:text-gray-300 break-words font-mono max-h-20 overflow-y-auto">
                    {typeof varValue === 'string' ? (
                      <pre>{varValue}</pre>
                    ) : (
                      <pre>{JSON.stringify(varValue, null, 2)}</pre>
                    )}
                  </div>
                )}

                {/* Usage hint */}
                <div className="text-[9px] text-gray-500 dark:text-gray-400">
                  Use in workflow: <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">{`{{variables.${varName}}}`}</code>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4 text-gray-400 dark:text-gray-500 text-sm">
            <p>No workflow variables yet</p>
            <p className="text-xs mt-1">Create variables to share data between nodes</p>
          </div>
        )}
      </div>

      {/* Info Section */}
      <div className="border-t dark:border-gray-700 p-3 text-[10px] text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 space-y-1">
        <div><strong>💡 Tips:</strong></div>
        <ul className="list-disc list-inside space-y-0.5 pl-1">
          <li>Extract values from API responses using "Store Response Fields"</li>
          <li>Reference variables anywhere: <code className="bg-gray-200 dark:bg-gray-700 px-1">{`{{variables.name}}`}</code></li>
          <li>Variables persist throughout workflow execution</li>
          <li>Great for storing tokens, IDs, and authentication data</li>
        </ul>
        
        <div className="mt-2 pt-2 border-t border-gray-300 dark:border-gray-600"><strong>🌳 Parallel Branches:</strong></div>
        <ul className="list-disc list-inside space-y-0.5 pl-1">
          <li>Access specific branches: <code className="bg-gray-200 dark:bg-gray-700 px-1">{`{{prev[0].response}}`}</code></li>
          <li>Branch indexes shown on Merge node after execution</li>
          <li>Example: <code className="bg-gray-200 dark:bg-gray-700 px-1">{`{{prev[1].response.body.id}}`}</code></li>
          <li>Single predecessor: <code className="bg-gray-200 dark:bg-gray-700 px-1">{`{{prev.response}}`}</code></li>
        </ul>
      </div>
    </div>
  );
};

export default VariablesPanel;
