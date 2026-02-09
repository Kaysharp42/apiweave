import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import API_BASE_URL from '../utils/api';
import { usePalette } from './PaletteContext';
import useSidebarStore from '../stores/SidebarStore';

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
  
  // Get palette context to load templates
  const { addImportedGroup, removeImportedGroup, clearImportedGroups } = usePalette();
  
  // Track extractor-based variables using ref so we can distinguish them from manual variables
  // Using ref instead of state to avoid dependency issues in registerExtractors callback
  const extractorVariablesRef = useRef({});

  // Callback ref for WorkflowCanvas to handle variable-deleted cleanup (extractor removal)
  // This replaces the old `window.dispatchEvent(new CustomEvent('variableDeleted', ...))` pattern.
  const onVariablesDeletedRef = useRef(null);

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

  // Load node templates from workflow into Add Nodes panel
  useEffect(() => {
    // Generate unique IDs for this workflow's template groups
    const templateGroupId = `workflow-templates-${workflowId}`;
    const openApiGroupId = `openapi-${workflowId}`;
    const harGroupId = `har-${workflowId}`;
    const curlGroupId = `curl-${workflowId}`;
    
    // Remove previous workflow's templates when switching workflows
    return () => {
      console.log('🧹 Cleaning up templates for workflow:', workflowId);
      removeImportedGroup(templateGroupId);
      removeImportedGroup(openApiGroupId);
      removeImportedGroup(harGroupId);
      removeImportedGroup(curlGroupId);
    };
  }, [workflowId, removeImportedGroup]);

  // Load templates after cleanup
  useEffect(() => {
    if (!initialWorkflow?.nodeTemplates || initialWorkflow.nodeTemplates.length === 0) {
      console.log('📦 No node templates to load for workflow:', workflowId);
      return;
    }

    console.log('📦 Loading', initialWorkflow.nodeTemplates.length, 'node templates for workflow:', workflowId);
    
    // Convert nodes to palette item format
    const templateItems = initialWorkflow.nodeTemplates.map(node => ({
      label: node.label || node.config?.url || 'Request',
      url: node.config?.url || '',
      method: node.config?.method || 'GET',
      headers: node.config?.headers || '',
      body: node.config?.body || '',
      queryParams: node.config?.queryParams || '',
      pathVariables: node.config?.pathVariables || '',
      cookies: node.config?.cookies || '',
      timeout: node.config?.timeout || 30,
    }));

    // Add templates to palette with workflow-specific ID
    addImportedGroup({
      title: 'Workflow Templates',
      id: `workflow-templates-${workflowId}`,
      items: templateItems,
    });
  }, [workflowId, initialWorkflow, addImportedGroup]);

  // Fetch collections once when component mounts
  useEffect(() => {
    console.log('🔵 fetchCollections useEffect triggered');
    fetchCollections();
  }, [fetchCollections]);

  // React to Zustand collection version changes
  const collectionVersion = useSidebarStore((s) => s.collectionVersion);
  useEffect(() => {
    if (collectionVersion > 0) {
      console.log('🔵 collectionVersion changed, refreshing collections');
      fetchCollections();
    }
  }, [collectionVersion, fetchCollections]);

  // Listen for variable updates from WorkflowCanvas (e.g., when extractors are deleted)
  // NOTE: The `variablesToUpdate` event had no remaining dispatchers — this listener
  // is removed. Variables are now updated directly via context methods.

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

  /**
   * Delete variables AND notify WorkflowCanvas to clean up extractors.
   * This replaces the old `window.dispatchEvent(new CustomEvent('variableDeleted', ...))`.
   * VariablesPanel calls this; WorkflowCanvas sets `onVariablesDeletedRef` to handle cleanup.
   */
  const deleteVariablesWithCleanup = useCallback((varNames) => {
    // Remove from context variables
    setVariables(prev => {
      const updated = { ...prev };
      varNames.forEach(name => delete updated[name]);
      return updated;
    });
    // Notify WorkflowCanvas to remove matching extractors from nodes
    if (onVariablesDeletedRef.current) {
      onVariablesDeletedRef.current(varNames);
    }
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
    // Trigger workflow refresh in sidebar via Zustand store
    useSidebarStore.getState().signalWorkflowsRefresh();
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
    deleteVariablesWithCleanup,
    updateVariables,
    updateSettings,
    registerExtractors,
    fetchCollections,
    refreshCollectionsAndWorkflows,
    onVariablesDeletedRef,
  };

  return (
    <WorkflowContext.Provider value={contextValue}>
      {children}
    </WorkflowContext.Provider>
  );
};

export default WorkflowContext;
