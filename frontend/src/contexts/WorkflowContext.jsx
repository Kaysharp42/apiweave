import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import API_BASE_URL from '../utils/api';

/**
 * WorkflowContext - Single Source of Truth for Workflow State
 * 
 * This context manages all workflow-related state including:
 * - Workflow variables (from extractors and manual additions)
 * - Nodes and edges
 * - Settings
 * 
 * Benefits:
 * - Eliminates sync issues between components
 * - Single source of truth
 * - Automatic updates across all consumers
 * - Cleaner data flow
 */

const WorkflowContext = createContext(null);

export const useWorkflow = () => {
  const context = useContext(WorkflowContext);
  if (!context) {
    throw new Error('useWorkflow must be used within a WorkflowProvider');
  }
  return context;
};

export const WorkflowProvider = ({ children, workflowId, initialWorkflow }) => {
  // Core workflow state - ONLY VARIABLES AND SETTINGS
  const [variables, setVariables] = useState(initialWorkflow?.variables || {});
  const [settings, setSettings] = useState(initialWorkflow?.settings || {});
  const [collections, setCollections] = useState([]);
  const [isLoadingCollections, setIsLoadingCollections] = useState(false);
  const [currentCollectionId, setCurrentCollectionId] = useState(initialWorkflow?.collectionId || null);
  
  // Track extractor-based variables using ref so we can distinguish them from manual variables
  // Using ref instead of state to avoid dependency issues in registerExtractors callback
  const extractorVariablesRef = useRef({});

  // Fetch available collections - MUST be defined before useEffect that calls it
  const fetchCollections = useCallback(async () => {
    setIsLoadingCollections(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/collections`);
      if (response.ok) {
        const data = await response.json();
        console.log('✅ Collections loaded:', data.length, 'items');
        setCollections(data);
      }
    } catch (error) {
      console.error('Error fetching collections:', error);
    } finally {
      setIsLoadingCollections(false);
    }
  }, []);

  // Sync state when workflow changes (e.g., switching tabs)
  useEffect(() => {
    console.log('🔄 WorkflowContext: Initializing with workflow:', workflowId);
    setVariables(initialWorkflow?.variables || {});
    setSettings(initialWorkflow?.settings || {});
    setCurrentCollectionId(initialWorkflow?.collectionId || null);
    extractorVariablesRef.current = {};
  }, [workflowId, initialWorkflow]);

  // Fetch collections once when component mounts
  useEffect(() => {
    console.log('🔵 fetchCollections useEffect triggered');
    fetchCollections();
    
    const handleCollectionsChanged = () => {
      console.log('🔵 collectionsChanged event fired');
      fetchCollections();
    };
    
    window.addEventListener('collectionsChanged', handleCollectionsChanged);
    return () => window.removeEventListener('collectionsChanged', handleCollectionsChanged);
  }, [fetchCollections]);

  // Listen for variable updates from WorkflowCanvas (e.g., when extractors are deleted)
  useEffect(() => {
    const handleVariablesUpdate = (event) => {
      if (event.detail.workflowId === workflowId) {
        console.log('📝 WorkflowContext: Updating variables from WorkflowCanvas:', event.detail.variables);
        setVariables(event.detail.variables);
      }
    };
    
    window.addEventListener('variablesToUpdate', handleVariablesUpdate);
    return () => window.removeEventListener('variablesToUpdate', handleVariablesUpdate);
  }, [workflowId]);

  // Update a specific variable
  const updateVariable = useCallback((varName, varValue) => {
    setVariables(prev => ({
      ...prev,
      [varName]: varValue
    }));
  }, []);

  // Delete a variable
  const deleteVariable = useCallback((varName) => {
    setVariables(prev => {
      const updated = { ...prev };
      delete updated[varName];
      return updated;
    });
  }, []);

  // Bulk update variables
  const updateVariables = useCallback((newVariables) => {
    setVariables(newVariables);
  }, []);

  // Update settings
  const updateSettings = useCallback((newSettings) => {
    setSettings(prev => ({
      ...prev,
      ...newSettings
    }));
  }, []);
  
  // Callback for WorkflowCanvas to register extractors - directly updates variables
  const registerExtractors = useCallback((extractors) => {
    // Get previous extractor variable names
    const prevExtractorVarNames = Object.keys(extractorVariablesRef.current);
    
    // Update the ref with new extractors
    extractorVariablesRef.current = extractors;
    
    // Rebuild variables by merging manual variables with new extractor variables
    setVariables(prev => {
      // Identify manual variables (those NOT in previous extractor list)
      const manualVariables = {};
      Object.entries(prev).forEach(([key, value]) => {
        // If this variable was NOT an extractor before, it's manual - keep it
        if (!prevExtractorVarNames.includes(key)) {
          manualVariables[key] = value;
        }
      });
      
      // Merge manual variables with new extractors
      const merged = {
        ...manualVariables,
        ...extractors
      };
      
      console.log('🔄 Merged variables:', {
        manual: Object.keys(manualVariables),
        extractors: Object.keys(extractors),
        merged: Object.keys(merged)
      });
      
      return merged;
    });
  }, []);

  // Get current collection object
  const currentCollection = currentCollectionId 
    ? collections.find(c => c.collectionId === currentCollectionId) 
    : null;

  // Refresh both collections and trigger workflow refresh
  const refreshCollectionsAndWorkflows = useCallback(() => {
    fetchCollections();
    // Trigger workflow refresh in sidebar
    window.dispatchEvent(new CustomEvent('workflowsNeedRefresh'));
  }, [fetchCollections]);

  const contextValue = {
    // State
    workflowId,
    variables,
    settings,
    collections,
    isLoadingCollections,
    currentCollectionId,
    currentCollection,

    // State setters
    setVariables,
    setSettings,
    setCurrentCollectionId,

    // Helper methods
    updateVariable,
    deleteVariable,
    updateVariables,
    updateSettings,
    registerExtractors,
    fetchCollections,
    refreshCollectionsAndWorkflows,
  };

  return (
    <WorkflowContext.Provider value={contextValue}>
      {children}
    </WorkflowContext.Provider>
  );
};

export default WorkflowContext;
