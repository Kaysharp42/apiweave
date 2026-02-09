import React, { useState, useEffect, useRef } from 'react';
import { Upload, Settings, Plus, FolderOpen, Download, Terminal } from 'lucide-react';
import WorkflowExportImport from '../WorkflowExportImport';
import HARImport from '../HARImport';
import OpenAPIImport from '../OpenAPIImport';
import CurlImport from '../CurlImport';
import CollectionExportImport from '../CollectionExportImport';

const SidebarHeader = ({ selectedNav, onCreateNew, isRefreshing }) => {
  const [showWorkflowImportExport, setShowWorkflowImportExport] = useState(false);
  const [showHARImport, setShowHARImport] = useState(false);
  const [showOpenAPIImport, setShowOpenAPIImport] = useState(false);
  const [showCurlImport, setShowCurlImport] = useState(false);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showCollectionImportExport, setShowCollectionImportExport] = useState(false);
  const [collectionImportMode, setCollectionImportMode] = useState(null);
  const importMenuRef = useRef(null);
  const collectionImportMenuRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (importMenuRef.current && !importMenuRef.current.contains(event.target)) {
        setShowImportMenu(false);
      }
      if (collectionImportMenuRef.current && !collectionImportMenuRef.current.contains(event.target)) {
        // Menu will close via modal
      }
    };

    if (showImportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showImportMenu]);

  const getHeaderTitle = () => {
    switch (selectedNav) {
      case 'workflows':
        return 'Workflows';
      case 'collections':
        return 'Collections';

      case 'settings':
        return 'Settings';
      default:
        return 'APIWeave';
    }
  };

  const getActionButtons = () => {
    switch (selectedNav) {
      case 'workflows':
        return (
          <div className="flex gap-0 w-full divide-x divide-gray-200 dark:divide-gray-700">
            <button
              onClick={onCreateNew}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-cyan-600 dark:text-cyan-400 hover:bg-cyan-50 dark:hover:bg-cyan-900/20 transition-colors duration-200 rounded-l-md flex-1 justify-center"
              style={{ minWidth: 0 }}
            >
              <Plus className="w-4 h-4" />
              <span>New</span>
            </button>
            <div className="relative flex-1 min-w-0" ref={importMenuRef}>
              <button
                onClick={() => setShowImportMenu(!showImportMenu)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200 rounded-r-md w-full justify-center"
                style={{ minWidth: 0 }}
              >
                <Upload className="w-4 h-4" />
                <span>Import</span>
              </button>
              {showImportMenu && (
                <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md shadow-lg z-10 min-w-[120px]">
                  <button
                    onClick={() => {
                      setShowWorkflowImportExport(true);
                      setShowImportMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <Download className="w-4 h-4" />
                    Workflow
                  </button>
                  <button
                    onClick={() => {
                      setShowHARImport(true);
                      setShowImportMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <Upload className="w-4 h-4" />
                    HAR File
                  </button>
                  <button
                    onClick={() => {
                      setShowOpenAPIImport(true);
                      setShowImportMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <Upload className="w-4 h-4" />
                    OpenAPI
                  </button>
                  <button
                    onClick={() => {
                      setShowCurlImport(true);
                      setShowImportMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <Terminal className="w-4 h-4" />
                    cURL
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      case 'collections':
        return (
          <div className="flex gap-0 w-full divide-x divide-gray-200 dark:divide-gray-700">
            <button
              onClick={onCreateNew}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-cyan-600 dark:text-cyan-400 hover:bg-cyan-50 dark:hover:bg-cyan-900/20 transition-colors duration-200 rounded-l-md flex-1 justify-center"
              style={{ minWidth: 0 }}
            >
              <Plus className="w-4 h-4" />
              <span>Create</span>
            </button>
            <div className="relative flex-1 min-w-0" ref={importMenuRef}>
              <button
                onClick={() => setShowImportMenu(!showImportMenu)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200 rounded-r-md w-full justify-center"
                style={{ minWidth: 0 }}
              >
                <Upload className="w-4 h-4" />
                <span>Import</span>
              </button>
              {showImportMenu && (
                <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md shadow-lg z-10 min-w-[140px]">
                  <button
                    onClick={() => {
                      setCollectionImportMode('import-collection');
                      setShowCollectionImportExport(true);
                      setShowImportMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <FolderOpen className="w-4 h-4" />
                    Collection
                  </button>
                  <button
                    onClick={() => {
                      setCollectionImportMode('import-har');
                      setShowCollectionImportExport(true);
                      setShowImportMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <Upload className="w-4 h-4" />
                    HAR File
                  </button>
                  <button
                    onClick={() => {
                      setCollectionImportMode('import-openapi');
                      setShowCollectionImportExport(true);
                      setShowImportMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <Upload className="w-4 h-4" />
                    OpenAPI
                  </button>
                  <button
                    onClick={() => {
                      setCollectionImportMode('import-curl');
                      setShowCollectionImportExport(true);
                      setShowImportMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <Terminal className="w-4 h-4" />
                    cURL
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <div className="flex flex-col border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        {/* Header Title */}
        <div className="px-4 py-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            {getHeaderTitle()}
            {isRefreshing && (
              <div className="w-4 h-4 border-2 border-gray-300 dark:border-gray-600 border-t-cyan-600 dark:border-t-cyan-400 rounded-full animate-spin"></div>
            )}
          </h2>
        </div>

        {/* Action Buttons */}
        {getActionButtons() && (
          <div className="flex items-center gap-1 px-4 pb-3">
            {getActionButtons()}
          </div>
        )}
      </div>

      {/* Modals */}
      {showWorkflowImportExport && (
        <WorkflowExportImport
          onClose={() => setShowWorkflowImportExport(false)}
          mode="import"
          onImportSuccess={() => {
            setShowWorkflowImportExport(false);
            window.dispatchEvent(new CustomEvent('workflowsNeedRefresh'));
          }}
        />
      )}
      {showHARImport && (
        <HARImport onClose={() => setShowHARImport(false)} />
      )}
      {showOpenAPIImport && (
        <OpenAPIImport onClose={() => setShowOpenAPIImport(false)} />
      )}
      {showCurlImport && (
        <CurlImport onClose={() => setShowCurlImport(false)} />
      )}
      {showCollectionImportExport && (
        <CollectionExportImport
          mode={collectionImportMode}
          isOpen={true}
          onClose={() => {
            setShowCollectionImportExport(false);
            setCollectionImportMode(null);
          }}
          onImportSuccess={() => {
            setShowCollectionImportExport(false);
            setCollectionImportMode(null);
            window.dispatchEvent(new CustomEvent('collectionsChanged'));
          }}
        />
      )}
    </>
  );
};

export default SidebarHeader;