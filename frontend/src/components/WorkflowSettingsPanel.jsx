import React, { useState, useEffect } from 'react';
import { useWorkflow } from '../contexts/WorkflowContext';
import API_BASE_URL from '../utils/api';
import { toast } from 'sonner';
import { ToggleLeft, ToggleRight, Check, X, RefreshCw, Plus, Info, ChevronDown, LayoutGrid } from 'lucide-react';

const WorkflowSettingsPanel = () => {
  const { 
    settings, 
    updateSettings, 
    workflowId, 
    collections, 
    isLoadingCollections, 
    refreshCollectionsAndWorkflows,
    currentCollection,
    currentCollectionId,
    setCurrentCollectionId
  } = useWorkflow();
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [showCollectionDropdown, setShowCollectionDropdown] = useState(false);
  
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
      toast.error('Workflow ID not found');
      return;
    }

    const selectedCollection = collections.find(c => c.collectionId === collectionId);
    if (!selectedCollection) {
      toast.error('Collection not found');
      return;
    }

    setAssignmentLoading(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/collections/${collectionId}/workflows/${workflowId}`,
        { method: 'POST' }
      );

      if (response.ok) {
        // Update current collection ID in context
        setCurrentCollectionId(selectedCollection.collectionId);
        
        // Show success notification with collection name and icon
        toast.success(`Workflow added to "${selectedCollection.name}"`);
        
        // Comprehensive refresh of collections and workflows
        if (refreshCollectionsAndWorkflows) {
          refreshCollectionsAndWorkflows();
        }
        
      } else {
        const errorData = await response.json();
        toast.error(errorData.message || 'Failed to add workflow to collection');
      }
    } catch (error) {
      console.error('Error assigning workflow to collection:', error);
      toast.error(`Failed to add workflow to collection: ${error.message}`);
    } finally {
      setAssignmentLoading(false);
    }
  };

  const handleRemoveFromCollection = async () => {
    if (!workflowId || !currentCollection) {
      toast.error('No collection assignment to remove');
      return;
    }

    setAssignmentLoading(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/collections/${currentCollection.collectionId}/workflows/${workflowId}`,
        { method: 'DELETE' }
      );

      if (response.ok) {
        // Clear current collection ID in context
        setCurrentCollectionId(null);
        
        // Show success notification
        toast.success(`Workflow removed from "${currentCollection.name}"`);
        
        // Comprehensive refresh of collections and workflows
        if (refreshCollectionsAndWorkflows) {
          refreshCollectionsAndWorkflows();
        }
        
      } else {
        const errorData = await response.json();
        toast.error(errorData.message || 'Failed to remove workflow from collection');
      }
    } catch (error) {
      console.error('Error removing workflow from collection:', error);
      toast.error(`Failed to remove workflow from collection: ${error.message}`);
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
            <ToggleRight className="w-4 h-4 flex-shrink-0" />
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
                      <Check className="w-3 h-3 text-green-600 dark:text-green-400 flex-shrink-0" />
                      Workflow continues even if an API fails
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <X className="w-3 h-3 text-red-600 dark:text-red-400 flex-shrink-0" />
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
            <LayoutGrid className="w-4 h-4 flex-shrink-0" />
            <span>Collections</span>
          </label>
          
          <div className="relative">
            {isLoadingCollections ? (
              <div className="flex items-center justify-center py-3 px-4 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-cyan-600 dark:border-cyan-400"></div>
                <span className="ml-2 text-sm text-gray-600 dark:text-gray-300">Loading collections...</span>
              </div>
            ) : currentCollection ? (
              // Show current collection assignment
              <div className="flex items-center justify-between px-4 py-3 text-sm bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-800 rounded">
                <div className="flex items-center gap-3">
                  {currentCollection.color && (
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0 border border-cyan-300 dark:border-cyan-600"
                      style={{ backgroundColor: currentCollection.color }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-cyan-900 dark:text-cyan-100 truncate">
                      {currentCollection.name}
                    </div>
                    {currentCollection.description && (
                      <div className="text-xs text-cyan-700 dark:text-cyan-300 truncate">
                        {currentCollection.description}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={handleRemoveFromCollection}
                  disabled={assignmentLoading}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Remove from collection"
                >
                  {assignmentLoading ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <X className="w-3 h-3" />
                  )}
                  <span>Remove</span>
                </button>
              </div>
            ) : collections && collections.length > 0 ? (
              // Show dropdown to add to collection
              <div className="relative">
                <button
                  onClick={() => setShowCollectionDropdown(!showCollectionDropdown)}
                  disabled={assignmentLoading}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  <div className="flex items-center gap-2">
                    <Plus className="w-4 h-4 text-gray-500 dark:text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-200" />
                    <span className="text-gray-700 dark:text-gray-200">Add to Collection</span>
                  </div>
                  <ChevronDown 
                    className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${
                      showCollectionDropdown ? 'rotate-180' : ''
                    }`} 
                  />
                </button>

                {showCollectionDropdown && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-60 overflow-y-auto">
                    <div className="py-1">
                      {collections.map((collection) => (
                        <button
                          key={collection.collectionId}
                          onClick={() => {
                            handleAssignToCollection(collection.collectionId);
                            setShowCollectionDropdown(false);
                          }}
                          disabled={assignmentLoading}
                          className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-3"
                        >
                          {collection.color && (
                            <div
                              className="w-3 h-3 rounded-full flex-shrink-0 border border-gray-300 dark:border-gray-500"
                              style={{ backgroundColor: collection.color }}
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
                              {collection.name}
                            </div>
                            {collection.description && (
                              <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                {collection.description}
                              </div>
                            )}
                          </div>
                          {assignmentLoading && (
                            <RefreshCw className="w-4 h-4 animate-spin text-cyan-600 dark:text-cyan-400 flex-shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center py-3 px-4 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded text-center">
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  <Info className="w-4 h-4 mx-auto mb-1 opacity-60" />
                  No collections available
                </div>
              </div>
            )}

            {/* Click outside to close dropdown */}
            {showCollectionDropdown && (
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setShowCollectionDropdown(false)}
              />
            )}
          </div>
        </div>

        {/* Info Section */}
        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-[10px] text-blue-700 dark:text-blue-300 space-y-1">
          <p className="flex items-center gap-1">
            <Info className="w-3 h-3 flex-shrink-0" />
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
