import React, { useState } from 'react';
import { FileText, X, Upload, CheckCircle, AlertCircle } from 'lucide-react';
import { MdCheckCircle } from 'react-icons/md';
import { usePalette } from '../contexts/PaletteContext';

const OpenAPIImport = ({ onClose, onImportSuccess }) => {
  const [openapiFile, setOpenapiFile] = useState(null);
  const [openapiJson, setOpenapiJson] = useState(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [sanitize, setSanitize] = useState(true);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const { addImportedGroup } = usePalette();

  const handleFileUpload = (file) => {
    if (!file) return;
    
    if (!file.name.endsWith('.json')) {
      setError('Please upload a JSON file (.json)');
      return;
    }

    setError(null);
    setOpenapiFile(file);
    
    // Read and parse the file
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        setOpenapiJson(parsed);
        
        // Auto-populate base URL from servers if available
        if (!baseUrl && parsed.servers && parsed.servers.length > 0) {
          setBaseUrl(parsed.servers[0].url);
        }
      } catch (err) {
        setError('Invalid JSON format');
      }
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    handleFileUpload(file);
  };

  const handlePreview = async () => {
    if (!openapiFile) {
      setError('Please select an OpenAPI file');
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append('file', openapiFile);

      const params = new URLSearchParams();
      if (baseUrl) params.append('base_url', baseUrl);
      if (selectedTags.length > 0) params.append('tag_filter', selectedTags.join(','));
      params.append('sanitize', sanitize);

      const response = await fetch(`/api/workflows/import/openapi/dry-run?${params}`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to preview OpenAPI file');
      }

      const data = await response.json();
      setPreview(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = async () => {
    if (!openapiFile) {
      setError('Please select an OpenAPI file');
      return;
    }
    if (!preview || !preview.nodes) {
      setError('Please run Preview first');
      return;
    }

    try {
      const items = (preview.nodes || [])
        .filter(n => n.type === 'http-request')
        .map(n => ({
          label: n.label,
          method: n.config?.method || 'GET',
          url: n.config?.url || '',
          headers: n.config?.headers || '',
          cookies: n.config?.cookies || '',
          queryParams: n.config?.queryParams || '',
          pathVariables: n.config?.pathVariables || '',
          body: n.config?.body || '',
          timeout: n.config?.timeout || 30,
        }));

      // Determine title: user input > filename with count
      const itemCount = items.length;
      let finalTitle = groupTitle && groupTitle.trim() 
        ? `${groupTitle.trim()} (${itemCount})`
        : `@${openapiFile.name.replace(/\.(json|yaml|yml)$/i, '')} (${itemCount})`;

      addImportedGroup({
        title: finalTitle,
        items,
      });

      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleServerSelect = (serverUrl) => {
    setBaseUrl(serverUrl);
  };

  const handleTagToggle = (tagName) => {
    setSelectedTags(prev => {
      if (prev.includes(tagName)) {
        return prev.filter(t => t !== tagName);
      } else {
        return [...prev, tagName];
      }
    });
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
              Import OpenAPI/Swagger
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
              Drag & drop your OpenAPI/Swagger JSON file here, or click to browse
            </p>
            <input
              type="file"
              accept=".json"
              onChange={(e) => handleFileUpload(e.target.files[0])}
              className="hidden"
              id="openapi-file-input"
            />
            <label
              htmlFor="openapi-file-input"
              className="inline-block px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 cursor-pointer"
            >
              Choose File
            </label>
            {openapiFile && (
              <p className="mt-2 text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                <MdCheckCircle className="w-4 h-4" />
                <span>{openapiFile.name}</span>
              </p>
            )}
          </div>

          {/* Options */}
          {openapiJson && (
            <div className="space-y-4">
              {/* Server Selection */}
              {preview?.availableServers && preview.availableServers.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Base URL (Server)
                  </label>
                  <select
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  >
                    <option value="">-- Select Server --</option>
                    {preview.availableServers.map((server, idx) => (
                      <option key={idx} value={server.url}>
                        {server.url} {server.description && `(${server.description})`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Custom Base URL */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Custom Base URL (optional)
                </label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>

              {/* Tag Filter */}
              {preview?.availableTags && preview.availableTags.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Filter by Tags (select to import only specific tags)
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {preview.availableTags.map((tag, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleTagToggle(tag.name)}
                        className={`px-3 py-1 rounded-full text-sm transition-colors ${
                          selectedTags.includes(tag.name)
                            ? 'bg-cyan-600 text-white'
                            : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                        }`}
                        title={tag.description}
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>
                  {selectedTags.length === 0 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      No tags selected - all endpoints will be imported
                    </p>
                  )}
                </div>
              )}

              {/* Sanitize Option */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="sanitize-openapi"
                  checked={sanitize}
                  onChange={(e) => setSanitize(e.target.checked)}
                  className="w-4 h-4"
                />
                <label htmlFor="sanitize-openapi" className="text-sm text-gray-700 dark:text-gray-300">
                  Sanitize sensitive headers (Authorization, API keys)
                </label>
              </div>

              {/* Group Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Palette Group Title (optional)
                </label>
                <input
                  type="text"
                  value={groupTitle}
                  onChange={(e) => setGroupTitle(e.target.value)}
                  placeholder={openapiFile?.name || 'My API Group'}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          {/* Preview Display */}
          {preview && (
            <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-4 bg-gray-50 dark:bg-gray-900">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">Preview</h3>
              </div>
              
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">API:</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {preview.stats?.apiTitle} (v{preview.stats?.apiVersion})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Endpoints:</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {preview.stats?.totalEndpoints}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Total Nodes:</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {preview.workflow?.nodeCount}
                  </span>
                </div>
                {selectedTags.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Selected Tags:</span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {selectedTags.join(', ')}
                    </span>
                  </div>
                )}
              </div>

              {/* Node Preview */}
              {preview.nodes && preview.nodes.length > 2 && (
                <div className="mt-4">
                  <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Sample Endpoints (first 5):
                  </h4>
                  <div className="space-y-1">
                    {preview.nodes.slice(1, 6).map((node, idx) => (
                      <div
                        key={idx}
                        className="text-xs px-2 py-1 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700"
                      >
                        <span className="font-mono text-cyan-600 dark:text-cyan-400">
                          {node.config?.method}
                        </span>{' '}
                        <span className="text-gray-700 dark:text-gray-300">{node.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="border-t dark:border-gray-700 p-4 flex justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            disabled={isLoading}
          >
            Cancel
          </button>
          <div className="flex gap-2">
            <button
              onClick={handlePreview}
              disabled={!openapiFile || isLoading}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Loading...' : 'Preview'}
            </button>
            <button
              onClick={handleImport}
              disabled={!preview || isLoading}
              className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Adding...' : 'Add to Nodes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OpenAPIImport;
