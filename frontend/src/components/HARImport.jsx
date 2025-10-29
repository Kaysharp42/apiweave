import React, { useState } from 'react';
import { Upload, FileText, AlertCircle, CheckCircle, X, List, GitBranch } from 'lucide-react';

const HARImport = ({ onClose, onImportSuccess }) => {
  const [harFile, setHarFile] = useState(null);
  const [harJson, setHarJson] = useState(null);
  const [importMode, setImportMode] = useState('linear');
  const [sanitize, setSanitize] = useState(true);
  const [dryRunResult, setDryRunResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);
  const [importResult, setImportResult] = useState(null);

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setHarFile(file);
      setError(null);
      setDryRunResult(null);

      // Read and parse HAR file
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const json = JSON.parse(event.target.result);
          setHarJson(json);
        } catch (err) {
          setError('Invalid HAR file: ' + err.message);
          setHarJson(null);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const file = e.dataTransfer.files[0];
    if (file) {
      // Simulate file input change
      const event = { target: { files: [file] } };
      handleFileSelect(event);
    }
  };

  const handlePreview = async () => {
    if (!harFile) {
      setError('Please select a HAR file first');
      return;
    }

    setError(null);
    setDryRunResult(null);

    try {
      const formData = new FormData();
      formData.append('file', harFile);
      formData.append('import_mode', importMode);
      formData.append('sanitize', sanitize);

      const response = await fetch('/api/workflows/import/har/dry-run', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Preview failed');
      }

      const result = await response.json();
      setDryRunResult(result);
    } catch (err) {
      console.error('Preview error:', err);
      setError(err.message);
    }
  };

  const handleImport = async () => {
    if (!harFile) {
      setError('Please select a HAR file first');
      return;
    }

    setImporting(true);
    setError(null);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append('file', harFile);
      formData.append('import_mode', importMode);
      formData.append('sanitize', sanitize);

      const response = await fetch('/api/workflows/import/har', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Import failed');
      }

      const result = await response.json();
      setImportResult(result);

      // Notify parent and close after delay
      if (onImportSuccess) {
        setTimeout(() => {
          onImportSuccess(result.workflowId);
        }, 1500);
      }
    } catch (err) {
      console.error('Import error:', err);
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Import HAR File
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* Info */}
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Import HTTP Archive (HAR) files to automatically create API test workflows from
                recorded browser sessions or API calls.
              </p>
            </div>

            {/* File Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                HAR File
              </label>
              <div
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center hover:border-blue-500 dark:hover:border-blue-400 transition-colors cursor-pointer"
              >
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                  Drag and drop your HAR file here, or click to browse
                </p>
                <input
                  type="file"
                  accept=".har,.json"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="har-file-input"
                />
                <label
                  htmlFor="har-file-input"
                  className="inline-block bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-4 rounded cursor-pointer"
                >
                  Select File
                </label>
                {harFile && (
                  <p className="mt-3 text-sm text-green-600 dark:text-green-400">
                    ✓ {harFile.name}
                  </p>
                )}
              </div>
            </div>

            {/* Import Options */}
            {harJson && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Import Mode
                  </label>
                  <div className="flex space-x-4">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="radio"
                        value="linear"
                        checked={importMode === 'linear'}
                        onChange={(e) => setImportMode(e.target.value)}
                        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      <List className="w-4 h-4 text-gray-500" />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        Linear (Sequential)
                      </span>
                    </label>
                    <label className="flex items-center space-x-2 cursor-pointer opacity-50 cursor-not-allowed">
                      <input
                        type="radio"
                        value="grouped"
                        checked={importMode === 'grouped'}
                        onChange={(e) => setImportMode(e.target.value)}
                        disabled
                        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      <GitBranch className="w-4 h-4 text-gray-500" />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        Grouped (Parallel) - Coming Soon
                      </span>
                    </label>
                  </div>
                </div>

                <label className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    checked={sanitize}
                    onChange={(e) => setSanitize(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Sanitize sensitive headers (Authorization, API keys, etc.)
                  </span>
                </label>
              </div>
            )}

            {/* Preview Result */}
            {dryRunResult && (
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <div className="bg-gray-50 dark:bg-gray-900 px-4 py-3 border-b dark:border-gray-700">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                    Preview
                  </h3>
                </div>
                <div className="p-4 space-y-4">
                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                        {dryRunResult.stats?.totalEntries || 0}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Total Requests</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                        {dryRunResult.stats?.nodes || 0}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Nodes</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                        {dryRunResult.stats?.edges || 0}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Edges</p>
                    </div>
                  </div>

                  {/* Entry Preview */}
                  {dryRunResult.preview && dryRunResult.preview.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                        First {dryRunResult.preview.length} requests:
                      </p>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {dryRunResult.preview.map((entry, idx) => (
                          <div
                            key={idx}
                            className="flex items-center space-x-3 text-xs bg-gray-50 dark:bg-gray-900 p-2 rounded"
                          >
                            <span className={`font-medium px-2 py-0.5 rounded ${
                              entry.method === 'GET' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' :
                              entry.method === 'POST' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                              entry.method === 'PUT' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' :
                              entry.method === 'DELETE' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
                              'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                            }`}>
                              {entry.method}
                            </span>
                            <span className="flex-1 text-gray-600 dark:text-gray-400 truncate">
                              {entry.url}
                            </span>
                            <span className="text-gray-500 dark:text-gray-500">
                              {entry.time}ms
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Import Result */}
            {importResult && (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="flex items-start">
                  <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 mr-2" />
                  <div>
                    <p className="font-medium text-green-800 dark:text-green-300">
                      Import successful!
                    </p>
                    <p className="text-sm text-green-700 dark:text-green-400 mt-1">
                      Created workflow with {importResult.stats?.totalRequests} HTTP request nodes
                    </p>
                    <p className="text-xs text-green-600 dark:text-green-500 mt-1">
                      Workflow ID: {importResult.workflowId}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <div className="flex items-start">
                  <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mr-2" />
                  <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex space-x-3 pt-4 border-t dark:border-gray-700">
              <button
                onClick={handlePreview}
                disabled={!harJson}
                className="flex-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-white font-medium py-2 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                <FileText className="w-4 h-4 mr-2" />
                Preview
              </button>
              <button
                onClick={handleImport}
                disabled={importing || !harJson}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {importing ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Import as Workflow
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HARImport;
