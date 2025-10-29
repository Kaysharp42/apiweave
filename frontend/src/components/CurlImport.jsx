import React, { useState, useEffect } from 'react';
import { Upload, FileText, AlertCircle, CheckCircle, X, Copy, Trash2 } from 'lucide-react';
import { MdCheckCircle } from 'react-icons/md';
import API_BASE_URL from '../utils/api';

const CurlImport = ({ onClose, onImportSuccess, currentWorkflowId }) => {
  const [curlInput, setCurlInput] = useState('');
  const [sanitize, setSanitize] = useState(true);
  const [dryRunResult, setDryRunResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [workflows, setWorkflows] = useState([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(currentWorkflowId || '');
  const [loadingWorkflows, setLoadingWorkflows] = useState(true);

  // Fetch available workflows on mount
  useEffect(() => {
    const fetchWorkflows = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/workflows?limit=100`);
        if (response.ok) {
          const data = await response.json();
          setWorkflows(data.workflows || []);
        }
      } catch (err) {
        console.error('Error fetching workflows:', err);
      } finally {
        setLoadingWorkflows(false);
      }
    };
    fetchWorkflows();
  }, []);

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      // Read file content
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const content = event.target.result;
          setCurlInput(content);
          setError(null);
          setDryRunResult(null);
        } catch (err) {
          setError('Failed to read file: ' + err.message);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const content = event.target.result;
          setCurlInput(content);
          setError(null);
          setDryRunResult(null);
        } catch (err) {
          setError('Failed to read file: ' + err.message);
        }
      };
      reader.readAsText(file);
    }
  };

  const handlePreview = async () => {
    if (!curlInput.trim()) {
      setError('Please enter a curl command');
      return;
    }

    setError(null);
    setDryRunResult(null);
    setIsLoading(true);

    try {
      const params = new URLSearchParams();
      params.append('curl_command', curlInput);
      params.append('sanitize', sanitize);

      const response = await fetch(`${API_BASE_URL}/api/workflows/import/curl/dry-run?${params}`, {
        method: 'POST',
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
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = async () => {
    if (!curlInput.trim()) {
      setError('Please enter a curl command');
      return;
    }

    setError(null);
    setImporting(true);
    setImportResult(null);

    try {
      const params = new URLSearchParams();
      params.append('curl_command', curlInput);
      params.append('sanitize', sanitize);
      if (selectedWorkflowId) {
        params.append('workflowId', selectedWorkflowId);
      }

      const response = await fetch(`${API_BASE_URL}/api/workflows/import/curl?${params}`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Import failed');
      }

      const data = await response.json();
      setImportResult(data);

      // If appending to existing workflow, trigger a reload event
      if (selectedWorkflowId) {
        // Dispatch event to reload the current workflow
        window.dispatchEvent(new CustomEvent('workflowUpdated', { detail: { workflowId: data.workflowId } }));
      }

      // Notify parent and close
      if (onImportSuccess) {
        onImportSuccess(data.workflowId);
      }
      onClose();
    } catch (err) {
      console.error('Import error:', err);
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleClear = () => {
    setCurlInput('');
    setDryRunResult(null);
    setError(null);
  };

  const handlePasteSample = () => {
    const sample = `curl -X GET "https://api.example.com/users/123" \\
  -H "Authorization: Bearer token123" \\
  -H "Content-Type: application/json"`;
    setCurlInput(sample);
    setError(null);
    setDryRunResult(null);
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
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Import curl Commands
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Info */}
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Import curl commands to automatically create API test workflows. Supports single or multiple commands (one per line or separated by &&).
            </p>
          </div>

          {/* File Upload Area */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragging
                ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-900/20'
                : 'border-gray-300 dark:border-gray-600'
            }`}
          >
            <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              Drag & drop a text file with curl commands here, or click to browse
            </p>
            <input
              type="file"
              accept=".txt,.sh,.curl"
              onChange={(e) => handleFileSelect(e.target.files[0])}
              className="hidden"
              id="curl-file-input"
            />
            <label
              htmlFor="curl-file-input"
              className="inline-block px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 cursor-pointer"
            >
              Choose File
            </label>
          </div>

          {/* Text Input Area */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Or paste curl commands here:
            </label>
            <textarea
              value={curlInput}
              onChange={(e) => setCurlInput(e.target.value)}
              placeholder={`curl -X GET "https://api.example.com/users" \\
  -H "Authorization: Bearer token123" \\
  -H "Content-Type: application/json"

curl -X POST "https://api.example.com/users" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"John","email":"john@example.com"}'`}
              className="w-full h-40 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
            <div className="mt-2 flex gap-2">
              <button
                onClick={handleClear}
                disabled={!curlInput}
                className="flex items-center gap-1 px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Clear
              </button>
              <button
                onClick={handlePasteSample}
                className="flex items-center gap-1 px-3 py-1 text-sm bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
              >
                <Copy className="w-4 h-4" />
                Paste Sample
              </button>
            </div>
          </div>

          {/* Options */}
          {curlInput && (
            <div className="space-y-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              {/* Workflow Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Destination Workflow
                </label>
                <select
                  value={selectedWorkflowId}
                  onChange={(e) => setSelectedWorkflowId(e.target.value)}
                  disabled={loadingWorkflows}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">
                    {loadingWorkflows ? 'Loading workflows...' : '+ Create New Workflow'}
                  </option>
                  {workflows.map((wf) => (
                    <option key={wf.workflowId} value={wf.workflowId}>
                      {wf.name} ({wf.nodes?.length || 0} nodes)
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 flex items-center gap-1">
                  {selectedWorkflowId ? (
                    <>
                      <MdCheckCircle className="w-4 h-4 text-green-600" />
                      <span>Will append to selected workflow</span>
                    </>
                  ) : (
                    <>
                      <span>○ Will create a new workflow</span>
                    </>
                  )}
                </p>
              </div>

              {/* Sanitize Option */}
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sanitize}
                  onChange={(e) => setSanitize(e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Sanitize sensitive headers (API keys, tokens, etc.)
                </span>
              </label>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <div className="flex items-start">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mr-2 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
              </div>
            </div>
          )}

          {/* Dry Run Result */}
          {dryRunResult && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="flex items-start">
                <CheckCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 mr-2 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
                    Preview: {dryRunResult.stats.totalRequests} request(s)
                  </h3>
                  <div className="text-sm text-blue-800 dark:text-blue-300 space-y-1">
                    <p><strong>Workflow:</strong> {dryRunResult.workflow.name}</p>
                    <p><strong>Nodes:</strong> {dryRunResult.workflow.nodeCount}</p>
                    <p><strong>Edges:</strong> {dryRunResult.workflow.edgeCount}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex space-x-3 p-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
          <button
            onClick={handlePreview}
            disabled={!curlInput || isLoading}
            className="flex-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-white font-medium py-2 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-800 dark:border-white border-t-transparent mr-2" />
                Previewing...
              </>
            ) : (
              <>
                <FileText className="w-4 h-4 mr-2" />
                Preview
              </>
            )}
          </button>
          <button
            onClick={handleImport}
            disabled={importing || !curlInput}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
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
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default CurlImport;
