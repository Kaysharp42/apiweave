import React, { useState, useEffect } from 'react';
import { useWorkflow } from '../contexts/WorkflowContext';
import API_BASE_URL from '../utils/api';
import { toast } from './Toaster';

const WorkflowSettingsPanel = () => {
  const { settings, updateSettings, workflowId, collections, isLoadingCollections } = useWorkflow();
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  
  useEffect(() => {
    console.log('WorkflowSettingsPanel - collections:', collections.length, collections);
  }, [collections]);
  
  const handleContinueOnFailChange = (value) => {
    updateSettings({
      continueOnFail: value,
    });
  };

  const handleAssignToCollection = async (collectionId) => {
    if (!workflowId) {
      alert('Workflow ID not found');
      return;
    }

    setAssignmentLoading(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/collections/${collectionId}/workflows/${workflowId}`,
        { method: 'POST' }
      );

      if (response.ok) {
        toast(`✅ Workflow added to "${collections.find(c => c.collectionId === collectionId)?.name || 'collection'}"`, 'success');
        // Optionally refresh or show success message
      } else {
        toast('Failed to add workflow to collection', 'error');
      }
    } catch (error) {
      console.error('Error assigning workflow to collection:', error);
      toast('Error: ' + error.message, 'error');
    } finally {
      setAssignmentLoading(false);
    }
  };

  return (
    <div className="w-full bg-white dark:bg-gray-800 h-full flex flex-col border-t dark:border-gray-700">
      <div className="p-3 space-y-4">
        {/* Continue on Fail Option */}
        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
            <span>Execution Settings</span>
          </label>
          
          <div className="p-3 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded space-y-3">
            {/* Continue on Fail Toggle */}
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 cursor-pointer flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.continueOnFail || false}
                    onChange={(e) => handleContinueOnFailChange(e.target.checked)}
                    className="w-4 h-4 rounded cursor-pointer"
                  />
                  Continue on Fail
                </label>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                  {settings.continueOnFail ? (
                    <span className="flex items-center gap-1">
                      <svg className="w-3 h-3 text-green-600 dark:text-green-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      Workflow continues even if an API fails
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <svg className="w-3 h-3 text-red-600 dark:text-red-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                      Workflow stops at the first API failure
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Collection Assignment Section */}
        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4z" />
              <path d="M3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6z" />
              <path d="M14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
            </svg>
            <span>Add to Collection</span>
          </label>
          
          <div className="p-3 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded space-y-3">
            {isLoadingCollections ? (
              <div className="flex items-center justify-center py-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-cyan-900 dark:border-cyan-400"></div>
                <span className="ml-2 text-xs text-gray-600 dark:text-gray-300">Loading collections...</span>
              </div>
            ) : collections && collections.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">Select a collection:</p>
                <div className="grid grid-cols-1 gap-2">
                  {collections.map((collection) => (
                    <button
                      key={collection.collectionId}
                      onClick={() => handleAssignToCollection(collection.collectionId)}
                      disabled={assignmentLoading}
                      className="w-full px-3 py-2 text-xs text-left rounded border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-600 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {collection.color && (
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: collection.color }}
                        />
                      )}
                      <span className="flex-1 min-w-0">
                        <span className="font-medium">{collection.name}</span>
                        {collection.description && (
                          <span className="text-[10px] text-gray-500 dark:text-gray-400 block truncate">{collection.description}</span>
                        )}
                      </span>
                      {assignmentLoading && (
                        <svg className="w-3 h-3 animate-spin flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400 py-2">
                No collections available. Create one from the Collections tab.
              </p>
            )}
          </div>
        </div>

        {/* Info Section */}
        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-[10px] text-blue-700 dark:text-blue-300 space-y-1">
          <p className="flex items-center gap-1">
            <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <strong>About Continue on Fail:</strong>
          </p>
          <ul className="list-disc list-inside space-y-0.5 pl-1">
            <li>When <strong>disabled (default)</strong>: Stops workflow at first failed API call</li>
            <li>When <strong>enabled</strong>: Continues to next API even if current one fails</li>
            <li>Useful for testing error scenarios or conditional workflows</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default WorkflowSettingsPanel;
