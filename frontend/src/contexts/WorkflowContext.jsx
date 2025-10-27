import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

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
  
  // Track extractor-based variables using ref so we can distinguish them from manual variables
  // Using ref instead of state to avoid dependency issues in registerExtractors callback
  const extractorVariablesRef = useRef({});

  // Sync state when workflow changes (e.g., switching tabs)
  useEffect(() => {
    console.log('🔄 WorkflowContext: Initializing with workflow:', workflowId);
    setVariables(initialWorkflow?.variables || {});
    setSettings(initialWorkflow?.settings || {});
    extractorVariablesRef.current = {};
  }, [workflowId, initialWorkflow]);

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

  const contextValue = {
    // State
    workflowId,
    variables,
    settings,

    // State setters
    setVariables,
    setSettings,

    // Helper methods
    updateVariable,
    deleteVariable,
    updateVariables,
    updateSettings,
    registerExtractors,
  };

  return (
    <WorkflowContext.Provider value={contextValue}>
      {children}
    </WorkflowContext.Provider>
  );
};

export default WorkflowContext;
