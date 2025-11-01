import React, { useState } from 'react';
import {
  X,
  Upload,
  AlertCircle,
  CheckCircle,
  Info,
  Terminal,
} from 'lucide-react';
import API_BASE_URL from '../utils/api';
import { usePalette } from '../contexts/PaletteContext';

const ImportToNodesPanel = ({
  isOpen,
  onClose,
  workflowId, // Current workflow ID
}) => {
  const { addImportedGroup } = usePalette();
  const [activeTab, setActiveTab] = useState('openapi'); // 'openapi', 'har', 'curl'
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [pastedText, setPastedText] = useState('');
  const [sanitize, setSanitize] = useState(true);
  const [importMode, setImportMode] = useState('linear'); // for HAR
  const fileInputRef = React.useRef(null);

  if (!isOpen) return null;

  // Handle file selection
  const handleFileSelect = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        setUploadedFile(JSON.stringify(json));
        setPastedText('');
        setMessage(null);
      } catch (err) {
        setMessage({
          type: 'error',
          title: 'Invalid File',
          text: 'File is not valid JSON',
        });
      }
    };
    reader.readAsText(file);
  };

  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelect(e.target.files[0]);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.currentTarget.classList.add('border-blue-500', 'bg-blue-50');
  };

  const handleDragLeave = (e) => {
    e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  // Helper function to save templates to workflow
  const saveTemplatesToWorkflow = async (templates, sourceType) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/workflows/${workflowId}/templates`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(templates),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to save templates');
      }

      const result = await response.json();
      console.log(`Saved ${result.totalTemplates} templates to workflow`);
    } catch (error) {
      console.error('Error saving templates to workflow:', error);
      throw error;
    }
  };

  // Helper function to convert nodes to template format for AddNodesPanel
  const nodesToPaletteItems = (nodes) => {
    return nodes.map(node => ({
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
  };

  // Import OpenAPI
  const handleImportOpenAPI = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      let fileContent;
      if (pastedText) {
        fileContent = pastedText;
      } else if (uploadedFile) {
        fileContent = uploadedFile;
      } else {
        setMessage({
          type: 'error',
          title: 'Error',
          text: 'Please upload or paste an OpenAPI file',
        });
        setIsLoading(false);
        return;
      }

      const formData = new FormData();
      const blob = new Blob([fileContent], { type: 'application/json' });
      formData.append('file', blob, 'openapi.json');

      // Use parse_only=true to get just the nodes
      const response = await fetch(
        `${API_BASE_URL}/api/workflows/import/openapi?sanitize=${sanitize}&parse_only=true`,
        {
          method: 'POST',
          body: formData,
        }
      );

      if (response.ok) {
        const result = await response.json();
        const nodes = result.nodes || [];
        
        if (nodes.length > 0) {
          // Save templates to workflow database
          await saveTemplatesToWorkflow(nodes, 'openapi');

          // Add to palette for immediate display
          const items = nodesToPaletteItems(nodes);
          addImportedGroup({
            title: 'OpenAPI Requests',
            id: `openapi-${workflowId}`,  // Use workflowId for consistent cleanup
            items: items,
          });

          setMessage({
            type: 'success',
            title: 'Import Successful',
            text: `${items.length} request(s) saved and added to Add Nodes panel`,
          });

          setTimeout(() => {
            onClose();
            setUploadedFile(null);
            setPastedText('');
          }, 2000);
        } else {
          setMessage({
            type: 'error',
            title: 'No Requests Found',
            text: 'Could not parse any requests from the OpenAPI file',
          });
        }
      } else {
        const error = await response.json();
        setMessage({
          type: 'error',
          title: 'Import Failed',
          text: error.detail || 'Failed to import OpenAPI',
        });
      }
    } catch (error) {
      setMessage({
        type: 'error',
        title: 'Error',
        text: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Import HAR
  const handleImportHAR = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      let fileContent;
      if (pastedText) {
        fileContent = pastedText;
      } else if (uploadedFile) {
        fileContent = uploadedFile;
      } else {
        setMessage({
          type: 'error',
          title: 'Error',
          text: 'Please upload or paste a HAR file',
        });
        setIsLoading(false);
        return;
      }

      const formData = new FormData();
      const blob = new Blob([fileContent], { type: 'application/json' });
      formData.append('file', blob, 'har.json');

      // Use parse_only=true to get just the nodes
      const response = await fetch(
        `${API_BASE_URL}/api/workflows/import/har?import_mode=${importMode}&sanitize=${sanitize}&parse_only=true`,
        {
          method: 'POST',
          body: formData,
        }
      );

      if (response.ok) {
        const result = await response.json();
        const nodes = result.nodes || [];
        
        if (nodes.length > 0) {
          // Save templates to workflow database
          await saveTemplatesToWorkflow(nodes, 'har');

          // Add to palette for immediate display
          const items = nodesToPaletteItems(nodes);
          addImportedGroup({
            title: 'HAR Requests',
            id: `har-${workflowId}`,  // Use workflowId for consistent cleanup
            items: items,
          });

          setMessage({
            type: 'success',
            title: 'Import Successful',
            text: `${items.length} request(s) saved and added to Add Nodes panel`,
          });

          setTimeout(() => {
            onClose();
            setUploadedFile(null);
            setPastedText('');
          }, 2000);
        } else {
          setMessage({
            type: 'error',
            title: 'No Requests Found',
            text: 'Could not parse any requests from the HAR file',
          });
        }
      } else {
        const error = await response.json();
        setMessage({
          type: 'error',
          title: 'Import Failed',
          text: error.detail || 'Failed to import HAR',
        });
      }
    } catch (error) {
      setMessage({
        type: 'error',
        title: 'Error',
        text: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Import Curl
  const handleImportCurl = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      if (!pastedText.trim()) {
        setMessage({
          type: 'error',
          title: 'Error',
          text: 'Please paste curl command(s)',
        });
        setIsLoading(false);
        return;
      }

      // Use parse_only=true to get just the nodes
      const response = await fetch(
        `${API_BASE_URL}/api/workflows/import/curl?sanitize=${sanitize}&parse_only=true&curl_command=${encodeURIComponent(pastedText)}`,
        {
          method: 'POST',
        }
      );

      if (response.ok) {
        const result = await response.json();
        const nodes = result.nodes || [];
        
        if (nodes.length > 0) {
          // Save templates to workflow database
          await saveTemplatesToWorkflow(nodes, 'curl');

          // Add to palette for immediate display
          const items = nodesToPaletteItems(nodes);
          addImportedGroup({
            title: 'Curl Requests',
            id: `curl-${workflowId}`,  // Use workflowId for consistent cleanup
            items: items,
          });

          setMessage({
            type: 'success',
            title: 'Import Successful',
            text: `${items.length} request(s) saved and added to Add Nodes panel`,
          });

          setTimeout(() => {
            onClose();
            setPastedText('');
          }, 2000);
        } else {
          setMessage({
            type: 'error',
            title: 'No Requests Found',
            text: 'Could not parse any requests from the curl command(s)',
          });
        }
      } else {
        const error = await response.json();
        setMessage({
          type: 'error',
          title: 'Import Failed',
          text: error.detail || 'Failed to import curl',
        });
      }
    } catch (error) {
      setMessage({
        type: 'error',
        title: 'Error',
        text: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = () => {
    if (activeTab === 'openapi') {
      handleImportOpenAPI();
    } else if (activeTab === 'har') {
      handleImportHAR();
    } else if (activeTab === 'curl') {
      handleImportCurl();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl w-full max-w-2xl max-h-screen overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b dark:border-gray-700">
          <h2 className="text-2xl font-bold dark:text-white">
            Import to Add Nodes
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
          >
            <X className="w-6 h-6 dark:text-gray-300" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <button
            onClick={() => {
              setActiveTab('openapi');
              setMessage(null);
              setUploadedFile(null);
              setPastedText('');
            }}
            className={`flex-1 px-4 py-3 font-medium text-center transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'openapi'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-gray-900'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            <Upload className="w-4 h-4" />
            OpenAPI
          </button>
          <button
            onClick={() => {
              setActiveTab('har');
              setMessage(null);
              setUploadedFile(null);
              setPastedText('');
            }}
            className={`flex-1 px-4 py-3 font-medium text-center transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'har'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-gray-900'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            <Upload className="w-4 h-4" />
            HAR
          </button>
          <button
            onClick={() => {
              setActiveTab('curl');
              setMessage(null);
              setUploadedFile(null);
              setPastedText('');
            }}
            className={`flex-1 px-4 py-3 font-medium text-center transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'curl'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-gray-900'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            <Terminal className="w-4 h-4" />
            Curl
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Messages */}
          {message && (
            <div
              className={`mb-4 p-4 rounded-lg flex gap-3 ${
                message.type === 'success'
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
              }`}
            >
              {message.type === 'success' ? (
                <CheckCircle className="w-5 h-5 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
              )}
              <div>
                <div className="font-medium">{message.title}</div>
                <div className="text-sm">{message.text}</div>
              </div>
            </div>
          )}

          {/* OpenAPI Tab */}
          {activeTab === 'openapi' && (
            <div className="space-y-4">
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex gap-2 text-sm text-blue-800 dark:text-blue-200">
                <Info size={18} className="flex-shrink-0 mt-0.5" />
                <span>Upload or paste an OpenAPI specification. Requests will be added to your Add Nodes panel.</span>
              </div>

              {/* File upload */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className="border-2 border-dashed dark:border-gray-600 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 transition-colors"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.yaml,.yml"
                  onChange={handleFileInputChange}
                  className="hidden"
                />
                <div onClick={() => fileInputRef.current?.click()}>
                  <Upload className="w-12 h-12 mx-auto text-gray-400 mb-2" />
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Click to upload or drag and drop
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    JSON or YAML OpenAPI files
                  </div>
                </div>
              </div>

              {/* Or paste */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Or paste OpenAPI spec
                </label>
                <textarea
                  value={pastedText}
                  onChange={(e) => {
                    setPastedText(e.target.value);
                    setUploadedFile(null);
                  }}
                  placeholder="Paste OpenAPI JSON/YAML here..."
                  className="w-full h-40 px-4 py-3 border dark:border-gray-600 rounded-lg font-mono text-sm dark:bg-gray-800 dark:text-gray-100"
                />
              </div>

              {/* Options */}
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={sanitize}
                    onChange={(e) => setSanitize(e.target.checked)}
                    className="w-4 h-4"
                  />
                  Sanitize secrets
                </label>
              </div>

              {/* Action button */}
              <button
                onClick={handleImport}
                disabled={isLoading || (!uploadedFile && !pastedText)}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition-colors"
              >
                {isLoading ? 'Processing...' : 'Add to Nodes'}
              </button>
            </div>
          )}

          {/* HAR Tab */}
          {activeTab === 'har' && (
            <div className="space-y-4">
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex gap-2 text-sm text-blue-800 dark:text-blue-200">
                <Info size={18} className="flex-shrink-0 mt-0.5" />
                <span>Upload or paste a HAR (HTTP Archive) file. Requests will be added to your Add Nodes panel.</span>
              </div>

              {/* File upload */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className="border-2 border-dashed dark:border-gray-600 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 transition-colors"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.har"
                  onChange={handleFileInputChange}
                  className="hidden"
                />
                <div onClick={() => fileInputRef.current?.click()}>
                  <Upload className="w-12 h-12 mx-auto text-gray-400 mb-2" />
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Click to upload or drag and drop
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    JSON or HAR files
                  </div>
                </div>
              </div>

              {/* Or paste */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Or paste HAR content
                </label>
                <textarea
                  value={pastedText}
                  onChange={(e) => {
                    setPastedText(e.target.value);
                    setUploadedFile(null);
                  }}
                  placeholder="Paste HAR JSON here..."
                  className="w-full h-40 px-4 py-3 border dark:border-gray-600 rounded-lg font-mono text-sm dark:bg-gray-800 dark:text-gray-100"
                />
              </div>

              {/* Options */}
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Import mode
                  </label>
                  <select
                    value={importMode}
                    onChange={(e) => setImportMode(e.target.value)}
                    className="w-full px-3 py-2 border dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-gray-100"
                  >
                    <option value="linear">Linear (sequential)</option>
                    <option value="parallel">Parallel</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={sanitize}
                    onChange={(e) => setSanitize(e.target.checked)}
                    className="w-4 h-4"
                  />
                  Sanitize secrets
                </label>
              </div>

              {/* Action button */}
              <button
                onClick={handleImport}
                disabled={isLoading || (!uploadedFile && !pastedText)}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition-colors"
              >
                {isLoading ? 'Processing...' : 'Add to Nodes'}
              </button>
            </div>
          )}

          {/* Curl Tab */}
          {activeTab === 'curl' && (
            <div className="space-y-4">
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex gap-2 text-sm text-blue-800 dark:text-blue-200">
                <Info size={18} className="flex-shrink-0 mt-0.5" />
                <span>Paste one or more curl commands. They will be parsed and added to your Add Nodes panel.</span>
              </div>

              {/* Curl textarea */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Curl Commands
                </label>
                <textarea
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder={'Paste curl command(s) here. Example:\ncurl -X GET "https://api.example.com/users"\ncurl -X POST "https://api.example.com/users" -H "Content-Type: application/json" -d \'{"name": "John"}\'\n\nOr multiple commands separated by && or on separate lines'}
                  className="w-full h-40 px-4 py-3 border dark:border-gray-600 rounded-lg font-mono text-sm dark:bg-gray-800 dark:text-gray-100"
                />
              </div>

              {/* Options */}
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={sanitize}
                    onChange={(e) => setSanitize(e.target.checked)}
                    className="w-4 h-4"
                  />
                  Sanitize secrets
                </label>
              </div>

              {/* Action button */}
              <button
                onClick={handleImport}
                disabled={isLoading || !pastedText.trim()}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition-colors"
              >
                {isLoading ? 'Processing...' : 'Add to Nodes'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImportToNodesPanel;
