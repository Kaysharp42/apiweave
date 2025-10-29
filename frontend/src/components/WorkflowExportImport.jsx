import React, { useState } from 'react';
import { Download, Upload, FileText, AlertCircle, CheckCircle, X } from 'lucide-react';

const WorkflowExportImport = ({ workflowId, workflowName, onClose, onImportSuccess }) => {
  const [activeTab, setActiveTab] = useState('export');
  const [includeEnvironment, setIncludeEnvironment] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importJson, setImportJson] = useState('');
  const [dryRunResult, setDryRunResult] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [error, setError] = useState(null);
  const [createMissingEnvs, setCreateMissingEnvs] = useState(true);

  const handleExport = async () => {
    setExporting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/workflows/${workflowId}/export?include_environment=${includeEnvironment}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Export failed');
      }

      const bundle = await response.json();

      // Download as JSON file
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${workflowName || 'workflow'}_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log('✅ Workflow exported successfully');
    } catch (err) {
      console.error('Export error:', err);
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImportFile(file);
      setImportJson('');
      setError(null);
      setDryRunResult(null);

      // Read file content
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const json = JSON.parse(event.target.result);
          setImportJson(JSON.stringify(json, null, 2));
        } catch (err) {
          setError('Invalid JSON file');
        }
      };
      reader.readAsText(file);
    }
  };

  const handleDryRun = async () => {
    setError(null);
    setDryRunResult(null);

    if (!importJson) {
      setError('Please select a file or paste JSON');
      return;
    }

    try {
      const bundle = JSON.parse(importJson);

      const response = await fetch('/api/workflows/import/dry-run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bundle),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Dry run failed');
      }

      const result = await response.json();
      setDryRunResult(result);
    } catch (err) {
      console.error('Dry run error:', err);
      setError(err.message);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    setImportResult(null);

    if (!importJson) {
      setError('Please select a file or paste JSON');
      setImporting(false);
      return;
    }

    try {
      const bundle = JSON.parse(importJson);

      const response = await fetch('/api/workflows/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bundle,
          createMissingEnvironments: createMissingEnvs,
          sanitize: true,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Import failed');
      }

      const result = await response.json();
      setImportResult(result);

      // Notify parent component
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
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Workflow Export / Import
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b dark:border-gray-700">
          <button
            onClick={() => setActiveTab('export')}
            className={`px-6 py-3 font-medium ${
              activeTab === 'export'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <Download className="w-4 h-4 inline mr-2" />
            Export
          </button>
          <button
            onClick={() => setActiveTab('import')}
            className={`px-6 py-3 font-medium ${
              activeTab === 'import'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <Upload className="w-4 h-4 inline mr-2" />
            Import
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'export' ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                  Export Workflow Bundle
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Download a complete workflow bundle including nodes, edges, variables, and
                  optional environment configuration.
                </p>
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <div className="flex items-start">
                  <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 mr-3 mt-0.5" />
                  <div className="text-sm text-blue-800 dark:text-blue-300">
                    <p className="font-medium mb-1">Secret values are never exported</p>
                    <p>
                      Any detected secrets (API keys, tokens, passwords) will be replaced with{' '}
                      <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">&lt;SECRET&gt;</code>{' '}
                      placeholders. You'll need to re-enter these values after importing.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <label className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    checked={includeEnvironment}
                    onChange={(e) => setIncludeEnvironment(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Include referenced environment (if any)
                  </span>
                </label>
              </div>

              {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-sm text-red-800 dark:text-red-300">
                  {error}
                </div>
              )}

              <button
                onClick={handleExport}
                disabled={exporting}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {exporting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                    Exporting...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Download Workflow Bundle
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                  Import Workflow Bundle
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Upload a workflow bundle JSON file or paste the JSON content directly.
                </p>
              </div>

              {/* File upload */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Upload File
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleFileSelect}
                    className="block w-full text-sm text-gray-500 dark:text-gray-400
                      file:mr-4 file:py-2 file:px-4
                      file:rounded-lg file:border-0
                      file:text-sm file:font-medium
                      file:bg-blue-50 file:text-blue-700
                      hover:file:bg-blue-100
                      dark:file:bg-blue-900/20 dark:file:text-blue-400
                      dark:hover:file:bg-blue-900/30"
                  />
                </div>
              </div>

              {/* Or paste JSON */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Or Paste JSON
                </label>
                <textarea
                  value={importJson}
                  onChange={(e) => {
                    setImportJson(e.target.value);
                    setError(null);
                    setDryRunResult(null);
                  }}
                  placeholder='{"workflow": {...}, "environments": [...], ...}'
                  className="w-full h-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                    bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm font-mono
                    focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Options */}
              <div className="space-y-3">
                <label className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    checked={createMissingEnvs}
                    onChange={(e) => setCreateMissingEnvs(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Create missing environments from bundle
                  </span>
                </label>
              </div>

              {/* Dry run result */}
              {dryRunResult && (
                <div className={`border rounded-lg p-4 ${
                  dryRunResult.valid
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                }`}>
                  <div className="flex items-start mb-2">
                    {dryRunResult.valid ? (
                      <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 mr-2" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mr-2" />
                    )}
                    <div className="flex-1">
                      <p className={`font-medium ${
                        dryRunResult.valid
                          ? 'text-green-800 dark:text-green-300'
                          : 'text-red-800 dark:text-red-300'
                      }`}>
                        {dryRunResult.valid ? 'Bundle is valid!' : 'Validation failed'}
                      </p>
                      
                      {dryRunResult.stats && (
                        <div className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                          <p>Nodes: {dryRunResult.stats.nodes}</p>
                          <p>Edges: {dryRunResult.stats.edges}</p>
                          <p>Variables: {dryRunResult.stats.variables}</p>
                          {dryRunResult.stats.secretReferences > 0 && (
                            <p className="text-yellow-700 dark:text-yellow-400">
                              ⚠️ {dryRunResult.stats.secretReferences} secret(s) need to be re-entered
                            </p>
                          )}
                        </div>
                      )}

                      {dryRunResult.errors && dryRunResult.errors.length > 0 && (
                        <ul className="mt-2 text-sm text-red-700 dark:text-red-300 list-disc list-inside">
                          {dryRunResult.errors.map((err, idx) => (
                            <li key={idx}>{err}</li>
                          ))}
                        </ul>
                      )}

                      {dryRunResult.warnings && dryRunResult.warnings.length > 0 && (
                        <ul className="mt-2 text-sm text-yellow-700 dark:text-yellow-400 list-disc list-inside">
                          {dryRunResult.warnings.map((warn, idx) => (
                            <li key={idx}>{warn}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Import result */}
              {importResult && (
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                  <div className="flex items-start">
                    <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 mr-2" />
                    <div>
                      <p className="font-medium text-green-800 dark:text-green-300">
                        Import successful!
                      </p>
                      <p className="text-sm text-green-700 dark:text-green-400 mt-1">
                        Workflow ID: {importResult.workflowId}
                      </p>
                      {importResult.secretReferences && importResult.secretReferences.length > 0 && (
                        <p className="text-sm text-yellow-700 dark:text-yellow-400 mt-2">
                          ⚠️ Remember to re-enter {importResult.secretReferences.length} secret value(s)
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-sm text-red-800 dark:text-red-300">
                  {error}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex space-x-3">
                <button
                  onClick={handleDryRun}
                  disabled={!importJson}
                  className="flex-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-white font-medium py-2 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Validate
                </button>
                <button
                  onClick={handleImport}
                  disabled={importing || !importJson || (dryRunResult && !dryRunResult.valid)}
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
                      Import Workflow
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkflowExportImport;
