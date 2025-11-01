import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Download,
  Upload,
  AlertCircle,
  CheckCircle,
  Info,
  FileJson,
  FileText,
  Package,
  Network,
  Lock,
  Target,
  Terminal,
} from 'lucide-react';
import API_BASE_URL from '../utils/api';

const CollectionExportImport = ({
  collectionId,
  collectionName,
  isOpen,
  onClose,
  mode = 'export', // 'export', 'import-collection', 'import-workflows'
  onImportSuccess = () => {},
}) => {
  const [activeTab, setActiveTab] = useState(mode);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [pastedJson, setPastedJson] = useState('');
  const [validation, setValidation] = useState(null);
  const [includeEnvironments, setIncludeEnvironments] = useState(true);
  const [importMode, setImportMode] = useState('linear'); // for HAR/OpenAPI
  const fileInputRef = useRef(null);
  const [createNewCollection, setCreateNewCollection] = useState(true);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [collections, setCollections] = useState([]);
  const [selectedTargetCollection, setSelectedTargetCollection] = useState(null);
  const [sanitize, setSanitize] = useState(true);

  // Update activeTab when mode prop changes
  useEffect(() => {
    setActiveTab(mode);
  }, [mode]);

  // Fetch collections when importing workflows
  useEffect(() => {
    if (activeTab === 'import-workflows' || activeTab === 'import-har' || activeTab === 'import-openapi' || activeTab === 'import-curl') {
      fetchCollections();
    }
  }, [activeTab]);

  // Helper function to format error messages from backend
  const formatErrorMessage = (error) => {
    if (typeof error === 'string') {
      return error;
    }
    if (Array.isArray(error)) {
      // Pydantic validation errors are arrays of objects
      return error.map(err => {
        if (typeof err === 'object' && err.msg) {
          const location = err.loc ? err.loc.join(' -> ') : '';
          return location ? `${location}: ${err.msg}` : err.msg;
        }
        return JSON.stringify(err);
      }).join('; ');
    }
    if (typeof error === 'object' && error.msg) {
      // Single validation error object
      const location = error.loc ? error.loc.join(' -> ') : '';
      return location ? `${location}: ${error.msg}` : error.msg;
    }
    return 'An unknown error occurred';
  };

  // Fetch collections for import
  const fetchCollections = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/collections`);
      if (response.ok) {
        const data = await response.json();
        // Exclude current collection from import target list
        const filtered = data.filter(c => c.collectionId !== collectionId);
        setCollections(filtered);
      }
    } catch (error) {
      console.error('Error fetching collections:', error);
    }
  };

  // Export collection
  const handleExport = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/collections/${collectionId}/export?include_environment=${includeEnvironments}`
      );

      if (response.ok) {
        const bundle = await response.json();

        // Download as .awecollection file
        const dataStr = JSON.stringify(bundle, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${collectionName.replace(/\s+/g, '_')}.awecollection`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        setMessage({
          type: 'success',
          title: 'Export Successful',
          text: `Collection "${collectionName}" exported successfully.`,
        });
      } else {
        const error = await response.json();
        setMessage({
          type: 'error',
          title: 'Export Failed',
          text: formatErrorMessage(error.detail) || 'Failed to export collection',
        });
      }
    } catch (error) {
      setMessage({
        type: 'error',
        title: 'Export Error',
        text: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Validate collection import
  const handleValidateCollectionImport = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      let bundleData;
      if (pastedJson) {
        bundleData = JSON.parse(pastedJson);
      } else if (uploadedFile) {
        bundleData = JSON.parse(uploadedFile);
      } else {
        setMessage({
          type: 'error',
          title: 'Validation Error',
          text: 'Please upload or paste a collection bundle',
        });
        setIsLoading(false);
        return;
      }

      const response = await fetch(
        `${API_BASE_URL}/api/collections/import/dry-run`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bundle: bundleData,
            createNewCollection,
            targetCollectionId: selectedTargetCollection,
          }),
        }
      );

      if (response.ok) {
        const result = await response.json();
        setValidation(result);
        if (!result.valid) {
          setMessage({
            type: 'error',
            title: 'Validation Failed',
            text: result.errors.join(', '),
          });
        }
      } else {
        const error = await response.json();
        setMessage({
          type: 'error',
          title: 'Validation Failed',
          text: formatErrorMessage(error.detail) || 'Failed to validate bundle',
        });
      }
    } catch (error) {
      setMessage({
        type: 'error',
        title: 'Parse Error',
        text: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Import collection
  const handleImportCollection = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      let bundleData;
      if (pastedJson) {
        bundleData = JSON.parse(pastedJson);
      } else if (uploadedFile) {
        bundleData = JSON.parse(uploadedFile);
      } else {
        setMessage({
          type: 'error',
          title: 'Import Error',
          text: 'Please upload or paste a collection bundle',
        });
        setIsLoading(false);
        return;
      }

      const response = await fetch(
        `${API_BASE_URL}/api/collections/import`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bundle: bundleData,
            createNewCollection,
            newCollectionName: newCollectionName || bundleData.collection?.name,
            targetCollectionId: selectedTargetCollection,
            environmentMapping: {},
          }),
        }
      );

      if (response.ok) {
        const result = await response.json();
        setMessage({
          type: 'success',
          title: 'Import Successful',
          text: `Imported ${result.workflowCount} workflow(s) into collection.`,
        });

        // Reset form
        setUploadedFile(null);
        setPastedJson('');
        setValidation(null);
        setNewCollectionName('');

        // Refresh collections
        window.dispatchEvent(new CustomEvent('collectionsChanged'));

        // Call callback
        setTimeout(() => {
          onImportSuccess(result.collectionId);
          onClose();
        }, 2000);
      } else {
        const error = await response.json();
        setMessage({
          type: 'error',
          title: 'Import Failed',
          text: formatErrorMessage(error.detail) || 'Failed to import collection',
        });
      }
    } catch (error) {
      setMessage({
        type: 'error',
        title: 'Import Error',
        text: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Import workflow to collection
  const handleImportWorkflowToCollection = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      if (!selectedTargetCollection) {
        setMessage({
          type: 'error',
          title: 'Import Error',
          text: 'Please select a collection first',
        });
        setIsLoading(false);
        return;
      }

      let bundleData;
      let fileContent;
      
      if (pastedJson) {
        bundleData = JSON.parse(pastedJson);
        fileContent = pastedJson;
      } else if (uploadedFile) {
        bundleData = JSON.parse(uploadedFile);
        fileContent = uploadedFile;
      } else {
        setMessage({
          type: 'error',
          title: 'Import Error',
          text: 'Please upload or paste workflow data',
        });
        setIsLoading(false);
        return;
      }

      // Detect import type from bundle structure
      let detectedType = 'workflow';
      if (bundleData.swagger || bundleData.openapi) {
        detectedType = 'openapi';
      } else if (bundleData.log?.entries) {
        detectedType = 'har';
      }

      // Parse import file to get node templates (without creating workflow)
      let parseResponse;
      const formData = new FormData();
      
      if (detectedType === 'workflow') {
        // For workflow JSON, use existing import (already creates workflow)
        const blob = new Blob([fileContent], { type: 'application/json' });
        formData.append('file', blob, 'workflow.json');
        parseResponse = await fetch(
          `${API_BASE_URL}/api/workflows/import`,
          {
            method: 'POST',
            body: formData,
          }
        );
        
        // For workflow imports, old behavior: assign to collection
        if (parseResponse.ok) {
          const importResult = await parseResponse.json();
          const workflowId = importResult.workflowId;

          const assignResponse = await fetch(
            `${API_BASE_URL}/api/collections/${selectedTargetCollection}/workflows/${workflowId}/assign`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            }
          );

          if (assignResponse.ok) {
            setMessage({
              type: 'success',
              title: 'Import Successful',
              text: `Workflow imported and assigned to collection.`,
            });

            // Reset form
            setUploadedFile(null);
            setPastedJson('');
            setValidation(null);
            setSelectedTargetCollection(null);

            // Refresh
            window.dispatchEvent(new CustomEvent('workflowsNeedRefresh'));

            setTimeout(() => {
              onClose();
            }, 2000);
          } else {
            setMessage({
              type: 'error',
              title: 'Import Failed',
              text: 'Workflow imported but failed to assign to collection',
            });
          }
        } else {
          const error = await parseResponse.json();
          setMessage({
            type: 'error',
            title: 'Import Failed',
            text: formatErrorMessage(error.detail) || 'Failed to import workflow',
          });
        }
        setIsLoading(false);
        return;
      } else if (detectedType === 'openapi') {
        // Use OpenAPI endpoint with parse_only to get node templates
        const blob = new Blob([fileContent], { type: 'application/json' });
        formData.append('file', blob, 'openapi.json');
        parseResponse = await fetch(
          `${API_BASE_URL}/api/workflows/import/openapi?sanitize=${sanitize}&parse_only=true`,
          {
            method: 'POST',
            body: formData,
          }
        );
      } else if (detectedType === 'har') {
        // Use HAR endpoint with parse_only to get node templates
        const blob = new Blob([fileContent], { type: 'application/json' });
        formData.append('file', blob, 'har.json');
        parseResponse = await fetch(
          `${API_BASE_URL}/api/workflows/import/har?import_mode=${importMode}&sanitize=${sanitize}&parse_only=true`,
          {
            method: 'POST',
            body: formData,
          }
        );
      }

      // For OpenAPI/HAR: Create workflow with templates but empty canvas
      if (parseResponse.ok) {
        const parseResult = await parseResponse.json();
        const nodeTemplates = parseResult.nodes || [];

        // Generate start and end nodes for empty canvas
        const startNodeId = `start_${Date.now()}`;
        const endNodeId = `end_${Date.now()}`;
        
        const startNode = {
          nodeId: startNodeId,
          type: 'start',
          label: 'Start',
          data: {},
          position: { x: 100, y: 100 }
        };
        
        const endNode = {
          nodeId: endNodeId,
          type: 'end',
          label: 'End',
          data: {},
          position: { x: 100, y: 300 }
        };

        // Create workflow with templates
        const workflowName = detectedType === 'openapi' 
          ? `Imported OpenAPI - ${new Date().toLocaleString()}`
          : `Imported HAR - ${new Date().toLocaleString()}`;

        const createResponse = await fetch(
          `${API_BASE_URL}/api/workflows`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: workflowName,
              nodes: [startNode, endNode],
              edges: [{
                edgeId: `edge_${Date.now()}`,
                source: startNodeId,
                target: endNodeId
              }],
              nodeTemplates: nodeTemplates,
              collectionId: selectedTargetCollection,
              variables: {},
              tags: ['imported']
            })
          }
        );

        if (createResponse.ok) {
          setMessage({
            type: 'success',
            title: 'Import Successful',
            text: `Workflow created in collection with ${nodeTemplates.length} imported templates.`,
          });

          // Reset form
          setUploadedFile(null);
          setPastedJson('');
          setValidation(null);
          setSelectedTargetCollection(null);

          // Refresh
          window.dispatchEvent(new CustomEvent('workflowsNeedRefresh'));

          setTimeout(() => {
            onClose();
          }, 2000);
        } else {
          const error = await createResponse.json();
          setMessage({
            type: 'error',
            title: 'Create Failed',
            text: formatErrorMessage(error.detail) || 'Failed to create workflow with templates',
          });
        }
      } else {
        const error = await parseResponse.json();
        setMessage({
          type: 'error',
          title: 'Parse Failed',
          text: formatErrorMessage(error.detail) || 'Failed to parse import file',
        });
      }
    } catch (error) {
      setMessage({
        type: 'error',
        title: 'Import Error',
        text: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportCurlToCollection = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      if (!selectedTargetCollection) {
        setMessage({
          type: 'error',
          title: 'Import Error',
          text: 'Please select a collection first',
        });
        setIsLoading(false);
        return;
      }

      if (!pastedJson.trim()) {
        setMessage({
          type: 'error',
          title: 'Import Error',
          text: 'Please enter a cURL command',
        });
        setIsLoading(false);
        return;
      }

      const params = new URLSearchParams();
      params.append('curl_command', pastedJson);
      params.append('sanitize', sanitize);
      params.append('workflowId', selectedTargetCollection);

      const response = await fetch(`${API_BASE_URL}/api/workflows/import/curl?${params}`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Import failed');
      }

      const data = await response.json();

      setMessage({
        type: 'success',
        title: 'Import Successful',
        text: `cURL command imported and assigned to collection.`,
      });

      // Reset form
      setPastedJson('');
      setValidation(null);
      setSelectedTargetCollection(null);

      // Refresh
      window.dispatchEvent(new CustomEvent('collectionsChanged'));

      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (error) {
      setMessage({
        type: 'error',
        title: 'Import Error',
        text: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Handle file drop
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

  // Handle file selection
  const handleFileSelect = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      setUploadedFile(e.target.result);
      setPastedJson('');
      setValidation(null);
    };
    reader.readAsText(file);
  };

  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelect(e.target.files[0]);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl w-full max-w-2xl max-h-screen overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b dark:border-gray-700">
          <h2 className="text-2xl font-bold dark:text-white">
            {activeTab === 'export' && `Export Collection: ${collectionName}`}
            {activeTab === 'import-collection' && `Import Collection`}
            {activeTab === 'import-workflows' && `Import Workflow to Collection`}
            {activeTab === 'import-har' && `Import HAR File to Collection`}
            {activeTab === 'import-openapi' && `Import OpenAPI to Collection`}
            {activeTab === 'import-curl' && `Import cURL to Collection`}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <X size={24} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <button
            onClick={() => {
              setActiveTab('export');
              setMessage(null);
              setValidation(null);
            }}
            className={`flex-1 px-4 py-3 font-medium text-center transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'export'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-gray-900'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            <Download className="w-4 h-4" />
            Export Collection
          </button>
          <button
            onClick={() => {
              setActiveTab('import-collection');
              setMessage(null);
              setValidation(null);
              fetchCollections();
            }}
            className={`flex-1 px-4 py-3 font-medium text-center transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'import-collection'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-gray-900'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            <Upload className="w-4 h-4" />
            Import Collection
          </button>
          <button
            onClick={() => {
              setActiveTab('import-workflows');
              setMessage(null);
              setValidation(null);
            }}
            className={`flex-1 px-4 py-3 font-medium text-center transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'import-workflows'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-gray-900'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            <FileText className="w-4 h-4" />
            Import Workflows
          </button>
          <button
            onClick={() => {
              setActiveTab('import-har');
              setMessage(null);
              setValidation(null);
            }}
            className={`flex-1 px-4 py-3 font-medium text-center transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'import-har'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-gray-900'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            <Upload className="w-4 h-4" />
            HAR File
          </button>
          <button
            onClick={() => {
              setActiveTab('import-openapi');
              setMessage(null);
              setValidation(null);
            }}
            className={`flex-1 px-4 py-3 font-medium text-center transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'import-openapi'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-gray-900'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            <Upload className="w-4 h-4" />
            OpenAPI
          </button>
          <button
            onClick={() => {
              setActiveTab('import-curl');
              setMessage(null);
              setValidation(null);
            }}
            className={`flex-1 px-4 py-3 font-medium text-center transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'import-curl'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-gray-900'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            <Terminal className="w-4 h-4" />
            cURL
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
                  : message.type === 'warning'
                  ? 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
              }`}
            >
              {message.type === 'success' && <CheckCircle size={20} className="flex-shrink-0" />}
              {message.type === 'warning' && <AlertCircle size={20} className="flex-shrink-0" />}
              {message.type === 'error' && <AlertCircle size={20} className="flex-shrink-0" />}
              <div>
                <p className="font-bold">{message.title}</p>
                <p className="text-sm">{message.text}</p>
              </div>
            </div>
          )}

          {/* Export Tab */}
          {activeTab === 'export' && (
            <div className="space-y-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
                  Export this collection with all workflows and environments
                </p>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeEnvironments}
                    onChange={(e) => setIncludeEnvironments(e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  <span className="dark:text-gray-300">Include Environments</span>
                </label>
              </div>

              <button
                onClick={handleExport}
                disabled={isLoading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Download size={18} />
                {isLoading ? 'Exporting...' : 'Download Collection Bundle'}
              </button>
            </div>
          )}

          {/* Import Collection Tab */}
          {activeTab === 'import-collection' && (
            <div className="space-y-4">
              {/* Upload */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={32} className="mx-auto mb-2 text-gray-400" />
                <p className="font-medium dark:text-gray-300">Drag & drop collection bundle</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">or click to browse</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".awecollection,.json"
                  onChange={handleFileInputChange}
                  className="hidden"
                />
              </div>

              {uploadedFile && (
                <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg flex items-center gap-2 text-green-800 dark:text-green-200">
                  <CheckCircle size={18} />
                  <span className="text-sm">File loaded successfully</span>
                </div>
              )}

              {/* Paste JSON */}
              <div>
                <label className="block text-sm font-medium mb-2 dark:text-gray-300">
                  Or paste JSON:
                </label>
                <textarea
                  value={pastedJson}
                  onChange={(e) => {
                    setPastedJson(e.target.value);
                    setUploadedFile(null);
                  }}
                  placeholder="Paste collection JSON here..."
                  className="w-full h-32 px-3 py-2 border dark:border-gray-600 rounded-lg dark:bg-gray-800 dark:text-white resize-none"
                />
              </div>

              {/* Validation */}
              {validation && (
                <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg space-y-2">
                  <h4 className="font-medium dark:text-white">Validation Results</h4>
                  {validation.valid ? (
                    <p className="text-green-600 dark:text-green-400 text-sm flex items-center gap-2">
                      <CheckCircle size={16} /> Valid collection bundle
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {validation.errors.map((err, i) => (
                        <p key={i} className="text-red-600 dark:text-red-400 text-sm flex items-center gap-2">
                          <AlertCircle size={14} /> {err}
                        </p>
                      ))}
                    </div>
                  )}

                  {validation.warnings?.length > 0 && (
                    <div className="space-y-1">
                      {validation.warnings.map((warn, i) => (
                        <p key={i} className="text-yellow-600 dark:text-yellow-400 text-sm flex items-center gap-2">
                          <Info size={14} /> {warn}
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-gray-600 dark:text-gray-400">
                    <p className="flex items-center gap-1">
                      <Package className="w-3 h-3" /> Workflows: {validation.stats?.workflowCount || 0}
                    </p>
                    <p className="flex items-center gap-1">
                      <Network className="w-3 h-3" /> Environments: {validation.stats?.environmentCount || 0}
                    </p>
                    <p className="flex items-center gap-1">
                      <Lock className="w-3 h-3" /> Secrets: {validation.stats?.secretCount || 0}
                    </p>
                    <p className="flex items-center gap-1">
                      <Target className="w-3 h-3" /> Nodes: {validation.stats?.nodeCount || 0}
                    </p>
                  </div>
                </div>
              )}

              {/* Import options */}
              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    checked={createNewCollection}
                    onChange={() => setCreateNewCollection(true)}
                    className="w-4 h-4"
                  />
                  <span className="dark:text-gray-300">Create New Collection</span>
                </label>

                {createNewCollection && (
                  <input
                    type="text"
                    value={newCollectionName}
                    onChange={(e) => setNewCollectionName(e.target.value)}
                    placeholder="Collection name..."
                    className="ml-7 w-full px-3 py-2 border dark:border-gray-600 rounded-lg dark:bg-gray-800 dark:text-white"
                  />
                )}

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    checked={!createNewCollection}
                    onChange={() => setCreateNewCollection(false)}
                    className="w-4 h-4"
                  />
                  <span className="dark:text-gray-300">Import to Existing Collection</span>
                </label>

                {!createNewCollection && (
                  <select
                    value={selectedTargetCollection || ''}
                    onChange={(e) => setSelectedTargetCollection(e.target.value)}
                    className="ml-7 w-full px-3 py-2 border dark:border-gray-600 rounded-lg dark:bg-gray-800 dark:text-white"
                  >
                    <option value="">Select collection...</option>
                    {collections.map((c) => (
                      <option key={c.collectionId} value={c.collectionId}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleValidateCollectionImport}
                  disabled={isLoading || (!uploadedFile && !pastedJson)}
                  className="flex-1 bg-gray-300 hover:bg-gray-400 disabled:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Validate
                </button>
                <button
                  onClick={handleImportCollection}
                  disabled={
                    isLoading || !validation?.valid || (!createNewCollection && !selectedTargetCollection)
                  }
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <Upload size={18} />
                  {isLoading ? 'Importing...' : 'Import Collection'}
                </button>
              </div>
            </div>
          )}

          {/* Import Workflows Tab */}
          {activeTab === 'import-workflows' && (
            <div className="space-y-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
                  Import individual workflows, HAR files, or OpenAPI specs to this collection
                </p>
              </div>

              {/* Collection Selector */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Select Collection
                </label>
                <select
                  value={selectedTargetCollection || ''}
                  onChange={(e) => setSelectedTargetCollection(e.target.value || null)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">-- Choose a collection --</option>
                  {collections.map((col) => (
                    <option key={col.collectionId} value={col.collectionId}>
                      {col.name} ({col.workflowCount} workflows)
                    </option>
                  ))}
                </select>
                {collections.length === 0 && (
                  <p className="text-xs text-yellow-600 dark:text-yellow-400">
                    No collections available. Create a collection first.
                  </p>
                )}
              </div>

              {/* Upload */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={32} className="mx-auto mb-2 text-gray-400" />
                <p className="font-medium dark:text-gray-300">Drag & drop file or click to browse</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Supports: .json (workflow/OpenAPI), .har (HAR files)
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.har"
                  onChange={handleFileInputChange}
                  className="hidden"
                />
              </div>

              {uploadedFile && (
                <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg flex items-center gap-2 text-green-800 dark:text-green-200">
                  <CheckCircle size={18} />
                  <span className="text-sm">File loaded successfully</span>
                </div>
              )}

              {/* Options */}
              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sanitize}
                    onChange={(e) => setSanitize(e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  <span className="dark:text-gray-300">Sanitize sensitive headers</span>
                </label>
              </div>

              {/* Action button */}
              <button
                onClick={handleImportWorkflowToCollection}
                disabled={isLoading || !uploadedFile || !selectedTargetCollection}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                title={!selectedTargetCollection ? 'Please select a collection' : ''}
              >
                <Upload size={18} />
                {isLoading ? 'Importing...' : 'Import to Collection'}
              </button>
            </div>
          )}

          {/* Import HAR Tab */}
          {activeTab === 'import-har' && (
            <div className="space-y-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
                  Import individual workflows, HAR files, or OpenAPI specs to this collection
                </p>
              </div>

              {/* Collection Selector */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Select Collection
                </label>
                <select
                  value={selectedTargetCollection || ''}
                  onChange={(e) => setSelectedTargetCollection(e.target.value || null)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">-- Choose a collection --</option>
                  {collections.map((col) => (
                    <option key={col.collectionId} value={col.collectionId}>
                      {col.name} ({col.workflowCount} workflows)
                    </option>
                  ))}
                </select>
                {collections.length === 0 && (
                  <p className="text-xs text-yellow-600 dark:text-yellow-400">
                    No collections available. Create a collection first.
                  </p>
                )}
              </div>

              {/* Upload */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={32} className="mx-auto mb-2 text-gray-400" />
                <p className="font-medium dark:text-gray-300">Drag & drop file or click to browse</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Supports: .json (workflow/OpenAPI), .har (HAR files)
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.har"
                  onChange={handleFileInputChange}
                  className="hidden"
                />
              </div>

              {uploadedFile && (
                <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg flex items-center gap-2 text-green-800 dark:text-green-200">
                  <CheckCircle size={18} />
                  <span className="text-sm">File loaded successfully</span>
                </div>
              )}

              {/* Options */}
              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sanitize}
                    onChange={(e) => setSanitize(e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  <span className="dark:text-gray-300">Sanitize sensitive headers</span>
                </label>
              </div>

              {/* Action button */}
              <button
                onClick={handleImportWorkflowToCollection}
                disabled={isLoading || !uploadedFile || !selectedTargetCollection}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                title={!selectedTargetCollection ? 'Please select a collection' : ''}
              >
                <Upload size={18} />
                {isLoading ? 'Importing...' : 'Import to Collection'}
              </button>
            </div>
          )}

          {/* Import OpenAPI Tab */}
          {activeTab === 'import-openapi' && (
            <div className="space-y-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
                  Import individual workflows, HAR files, or OpenAPI specs to this collection
                </p>
              </div>

              {/* Collection Selector */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Select Collection
                </label>
                <select
                  value={selectedTargetCollection || ''}
                  onChange={(e) => setSelectedTargetCollection(e.target.value || null)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">-- Choose a collection --</option>
                  {collections.map((col) => (
                    <option key={col.collectionId} value={col.collectionId}>
                      {col.name} ({col.workflowCount} workflows)
                    </option>
                  ))}
                </select>
                {collections.length === 0 && (
                  <p className="text-xs text-yellow-600 dark:text-yellow-400">
                    No collections available. Create a collection first.
                  </p>
                )}
              </div>

              {/* Upload */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={32} className="mx-auto mb-2 text-gray-400" />
                <p className="font-medium dark:text-gray-300">Drag & drop file or click to browse</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Supports: .json (workflow/OpenAPI), .har (HAR files)
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.har"
                  onChange={handleFileInputChange}
                  className="hidden"
                />
              </div>

              {uploadedFile && (
                <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg flex items-center gap-2 text-green-800 dark:text-green-200">
                  <CheckCircle size={18} />
                  <span className="text-sm">File loaded successfully</span>
                </div>
              )}

              {/* Options */}
              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sanitize}
                    onChange={(e) => setSanitize(e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  <span className="dark:text-gray-300">Sanitize sensitive headers</span>
                </label>
              </div>

              {/* Action button */}
              <button
                onClick={handleImportWorkflowToCollection}
                disabled={isLoading || !uploadedFile || !selectedTargetCollection}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                title={!selectedTargetCollection ? 'Please select a collection' : ''}
              >
                <Upload size={18} />
                {isLoading ? 'Importing...' : 'Import to Collection'}
              </button>
            </div>
          )}

          {/* Import cURL Tab */}
          {activeTab === 'import-curl' && (
            <div className="space-y-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
                  Import cURL commands to create API test workflows in this collection
                </p>
              </div>

              {/* Collection Selector */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Select Collection
                </label>
                <select
                  value={selectedTargetCollection || ''}
                  onChange={(e) => setSelectedTargetCollection(e.target.value || null)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">-- Choose a collection --</option>
                  {collections.map((col) => (
                    <option key={col.collectionId} value={col.collectionId}>
                      {col.name} ({col.workflowCount} workflows)
                    </option>
                  ))}
                </select>
                {collections.length === 0 && (
                  <p className="text-xs text-yellow-600 dark:text-yellow-400">
                    No collections available. Create a collection first.
                  </p>
                )}
              </div>

              {/* cURL Input */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  cURL Command(s)
                </label>
                <textarea
                  value={pastedJson}
                  onChange={(e) => setPastedJson(e.target.value)}
                  placeholder="Paste your cURL command here (single or multiple commands separated by &&)"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                  rows="6"
                />
              </div>

              {/* Options */}
              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sanitize}
                    onChange={(e) => setSanitize(e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  <span className="dark:text-gray-300">Sanitize sensitive headers</span>
                </label>
              </div>

              {/* Action button */}
              <button
                onClick={handleImportCurlToCollection}
                disabled={isLoading || !pastedJson.trim() || !selectedTargetCollection}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                title={!selectedTargetCollection ? 'Please select a collection' : ''}
              >
                <Upload size={18} />
                {isLoading ? 'Importing...' : 'Import to Collection'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CollectionExportImport;
