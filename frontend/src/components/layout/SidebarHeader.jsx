import React, { useState } from 'react';
import { MdUpload, MdSettings, MdAdd, MdFolderOpen, MdDownload } from 'react-icons/md';
import { HiMiniCommandLine } from 'react-icons/hi2';
import WorkflowExportImport from '../WorkflowExportImport';
import HARImport from '../HARImport';
import OpenAPIImport from '../OpenAPIImport';
import CurlImport from '../CurlImport';

const SidebarHeader = ({ selectedNav, onCreateNew, onImport, isRefreshing }) => {
  const [showWorkflowImportExport, setShowWorkflowImportExport] = useState(false);
  const [showHARImport, setShowHARImport] = useState(false);
  const [showOpenAPIImport, setShowOpenAPIImport] = useState(false);
  const [showCurlImport, setShowCurlImport] = useState(false);
  const [showImportMenu, setShowImportMenu] = useState(false);

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
              <MdAdd className="w-4 h-4" />
              <span>New</span>
            </button>
            <div className="relative flex-1 min-w-0">
              <button
                onClick={() => setShowImportMenu(!showImportMenu)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200 rounded-r-md w-full justify-center"
                style={{ minWidth: 0 }}
              >
                <MdUpload className="w-4 h-4" />
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
                    <MdDownload className="w-4 h-4" />
                    Workflow
                  </button>
                  <button
                    onClick={() => {
                      setShowHARImport(true);
                      setShowImportMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <MdUpload className="w-4 h-4" />
                    HAR File
                  </button>
                  <button
                    onClick={() => {
                      setShowOpenAPIImport(true);
                      setShowImportMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <MdUpload className="w-4 h-4" />
                    OpenAPI
                  </button>
                  <button
                    onClick={() => {
                      setShowCurlImport(true);
                      setShowImportMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <HiMiniCommandLine className="w-4 h-4" />
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
              <MdAdd className="w-4 h-4" />
              <span>Create</span>
            </button>
            <button
              onClick={onImport}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200 rounded-r-md flex-1 justify-center"
              style={{ minWidth: 0 }}
            >
              <MdFolderOpen className="w-4 h-4" />
              <span>Import</span>
            </button>
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
    </>
  );
};

export default SidebarHeader;