import { useState, useRef, useEffect, type DragEvent, type ChangeEvent } from 'react';
import useSidebarStore from '../stores/SidebarStore';
import {
  X,
  Download,
  Upload,
  AlertCircle,
  CheckCircle,
  Info,
  FileText,
  Package,
  Network,
  Lock,
  Target,
  Terminal,
} from 'lucide-react';
import API_BASE_URL from '../utils/api';
import { Button } from './atoms/Button';
import { IconButton } from './atoms/IconButton';
import { Input } from './atoms/Input';
import { TextArea } from './atoms/TextArea';
import type { Collection } from '../types/Collection';
import { authenticatedFetch } from '../utils/authenticatedApi';

interface CollectionWithWorkflowCount extends Collection {
  workflowCount?: number;
}

interface MessageState {
  type: 'success' | 'warning' | 'error';
  title: string;
  text: string;
}

interface ValidationError {
  loc?: string[];
  msg: string;
}

interface ValidationStats {
  workflowCount?: number;
  environmentCount?: number;
  secretCount?: number;
  nodeCount?: number;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
  stats?: ValidationStats;
}

interface ImportResult {
  workflowCount: number;
  collectionId: string;
}

interface CollectionExportImportProps {
  collectionId?: string;
  collectionName?: string;
  isOpen: boolean;
  onClose: () => void;
  mode?: 'export' | 'import-collection' | 'import-workflows' | 'import-har' | 'import-openapi' | 'import-curl';
  onImportSuccess?: (collectionId: string) => void;
}

type TabId = 'export' | 'import-collection' | 'import-workflows' | 'import-har' | 'import-openapi' | 'import-curl';

type ImportModeType = 'linear' | 'parallel';

interface Position {
  x: number;
  y: number;
}

interface WorkflowNode {
  nodeId: string;
  type: string;
  label: string;
  data: Record<string, unknown>;
  position: Position;
}

interface WorkflowEdge {
  edgeId: string;
  source: string;
  target: string;
}

interface CreateWorkflowPayload {
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  nodeTemplates: Record<string, unknown>[];
  collectionId: string;
  variables: Record<string, unknown>;
  tags: string[];
}

export function CollectionExportImport({
  collectionId,
  collectionName,
  isOpen,
  onClose,
  mode = 'export',
  onImportSuccess = () => {},
}: CollectionExportImportProps) {
  const [activeTab, setActiveTab] = useState<TabId>(mode);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<MessageState | null>(null);
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [pastedJson, setPastedJson] = useState<string>('');
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [includeEnvironments, setIncludeEnvironments] = useState<boolean>(true);
  const [importMode] = useState<ImportModeType>('linear');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [createNewCollection, setCreateNewCollection] = useState<boolean>(true);
  const [newCollectionName, setNewCollectionName] = useState<string>('');
  const [collections, setCollections] = useState<CollectionWithWorkflowCount[]>([]);
  const [selectedTargetCollection, setSelectedTargetCollection] = useState<string | null>(null);
  const [sanitize, setSanitize] = useState<boolean>(true);

  useEffect(() => {
    setActiveTab(mode);
  }, [mode]);

  useEffect(() => {
    if (activeTab === 'import-workflows' || activeTab === 'import-har' || activeTab === 'import-openapi' || activeTab === 'import-curl') {
      fetchCollections();
    }
  }, [activeTab]);

  const formatErrorMessage = (error: unknown): string => {
    if (typeof error === 'string') {
      return error;
    }
    if (Array.isArray(error)) {
      return error.map((err: unknown) => {
        if (typeof err === 'object' && err !== null && 'msg' in err) {
          const errObj = err as ValidationError;
          const location = errObj.loc ? errObj.loc.join(' -> ') : '';
          return location ? `${location}: ${errObj.msg}` : errObj.msg;
        }
        return JSON.stringify(err);
      }).join('; ');
    }
    if (typeof error === 'object' && error !== null && 'msg' in error) {
      const errObj = error as ValidationError;
      const location = errObj.loc ? errObj.loc.join(' -> ') : '';
      return location ? `${location}: ${errObj.msg}` : errObj.msg;
    }
    return 'An unknown error occurred';
  };

  const fetchCollections = async (): Promise<void> => {
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/api/collections`);
      if (response.ok) {
        const data: CollectionWithWorkflowCount[] = await response.json();
        const filtered = data.filter((c: CollectionWithWorkflowCount) => c.collectionId !== collectionId);
        setCollections(filtered);
      }
    } catch (error) {
      console.error('Error fetching collections:', error);
    }
  };

  const handleExport = async (): Promise<void> => {
    setIsLoading(true);
    setMessage(null);

    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/collections/${collectionId}/export?include_environment=${includeEnvironments}`
      );

      if (response.ok) {
        const bundle: Record<string, unknown> = await response.json();

        const dataStr = JSON.stringify(bundle, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${(collectionName ?? 'collection').replace(/\s+/g, '_')}.awecollection`;
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
        const error: { detail?: unknown } = await response.json();
        setMessage({
          type: 'error',
          title: 'Export Failed',
          text: formatErrorMessage(error.detail) || 'Failed to export collection',
        });
      }
    } catch (error: unknown) {
      const err = error as Error;
      setMessage({
        type: 'error',
        title: 'Export Error',
        text: err.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleValidateCollectionImport = async (): Promise<void> => {
    setIsLoading(true);
    setMessage(null);

    try {
      let bundleData: Record<string, unknown>;
      if (pastedJson) {
        bundleData = JSON.parse(pastedJson) as Record<string, unknown>;
      } else if (uploadedFile) {
        bundleData = JSON.parse(uploadedFile) as Record<string, unknown>;
      } else {
        setMessage({
          type: 'error',
          title: 'Validation Error',
          text: 'Please upload or paste a collection bundle',
        });
        setIsLoading(false);
        return;
      }

      const response = await authenticatedFetch(
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
        const result: ValidationResult = await response.json();
        setValidation(result);
        if (!result.valid) {
          setMessage({
            type: 'error',
            title: 'Validation Failed',
            text: result.errors.join(', '),
          });
        }
      } else {
        const error: { detail?: unknown } = await response.json();
        setMessage({
          type: 'error',
          title: 'Validation Failed',
          text: formatErrorMessage(error.detail) || 'Failed to validate bundle',
        });
      }
    } catch (error: unknown) {
      const err = error as Error;
      setMessage({
        type: 'error',
        title: 'Parse Error',
        text: err.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportCollection = async (): Promise<void> => {
    setIsLoading(true);
    setMessage(null);

    try {
      let bundleData: Record<string, unknown>;
      if (pastedJson) {
        bundleData = JSON.parse(pastedJson) as Record<string, unknown>;
      } else if (uploadedFile) {
        bundleData = JSON.parse(uploadedFile) as Record<string, unknown>;
      } else {
        setMessage({
          type: 'error',
          title: 'Import Error',
          text: 'Please upload or paste a collection bundle',
        });
        setIsLoading(false);
        return;
      }

      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/collections/import`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bundle: bundleData,
            createNewCollection,
            newCollectionName: newCollectionName || (bundleData.collection as Record<string, unknown> | undefined)?.name,
            targetCollectionId: selectedTargetCollection,
            environmentMapping: {},
          }),
        }
      );

      if (response.ok) {
        const result: ImportResult = await response.json();
        setMessage({
          type: 'success',
          title: 'Import Successful',
          text: `Imported ${result.workflowCount} workflow(s) into collection.`,
        });

        setUploadedFile(null);
        setPastedJson('');
        setValidation(null);
        setNewCollectionName('');

        useSidebarStore.getState().signalCollectionsRefresh();

        setTimeout(() => {
          onImportSuccess(result.collectionId);
          onClose();
        }, 2000);
      } else {
        const error: { detail?: unknown } = await response.json();
        setMessage({
          type: 'error',
          title: 'Import Failed',
          text: formatErrorMessage(error.detail) || 'Failed to import collection',
        });
      }
    } catch (error: unknown) {
      const err = error as Error;
      setMessage({
        type: 'error',
        title: 'Import Error',
        text: err.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportWorkflowToCollection = async (): Promise<void> => {
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

      let bundleData: Record<string, unknown>;
      let fileContent: string;

      if (pastedJson) {
        bundleData = JSON.parse(pastedJson) as Record<string, unknown>;
        fileContent = pastedJson;
      } else if (uploadedFile) {
        bundleData = JSON.parse(uploadedFile) as Record<string, unknown>;
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

      let detectedType: 'workflow' | 'openapi' | 'har' = 'workflow';
      if (bundleData.swagger || bundleData.openapi) {
        detectedType = 'openapi';
      } else if ((bundleData.log as Record<string, unknown> | undefined)?.entries) {
        detectedType = 'har';
      }

      let parseResponse: Response;
      const formData = new FormData();

      if (detectedType === 'workflow') {
        const blob = new Blob([fileContent], { type: 'application/json' });
        formData.append('file', blob, 'workflow.json');
        parseResponse = await authenticatedFetch(
          `${API_BASE_URL}/api/workflows/import`,
          {
            method: 'POST',
            body: formData,
          }
        );

        if (parseResponse.ok) {
          const importResult: { workflowId: string } = await parseResponse.json();
          const workflowId = importResult.workflowId;

          const assignResponse = await authenticatedFetch(
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

            setUploadedFile(null);
            setPastedJson('');
            setValidation(null);
            setSelectedTargetCollection(null);

            useSidebarStore.getState().signalWorkflowsRefresh();

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
          const error: { detail?: unknown } = await parseResponse.json();
          setMessage({
            type: 'error',
            title: 'Import Failed',
            text: formatErrorMessage(error.detail) || 'Failed to import workflow',
          });
        }
        setIsLoading(false);
        return;
      } else if (detectedType === 'openapi') {
        const blob = new Blob([fileContent], { type: 'application/json' });
        formData.append('file', blob, 'openapi.json');
        parseResponse = await authenticatedFetch(
          `${API_BASE_URL}/api/workflows/import/openapi?sanitize=${sanitize}&parse_only=true`,
          {
            method: 'POST',
            body: formData,
          }
        );
      } else {
        const blob = new Blob([fileContent], { type: 'application/json' });
        formData.append('file', blob, 'har.json');
        parseResponse = await authenticatedFetch(
          `${API_BASE_URL}/api/workflows/import/har?import_mode=${importMode}&sanitize=${sanitize}&parse_only=true`,
          {
            method: 'POST',
            body: formData,
          }
        );
      }

      if (parseResponse.ok) {
        const parseResult: { nodes?: Record<string, unknown>[] } = await parseResponse.json();
        const nodeTemplates = parseResult.nodes || [];

        const startNodeId = `start_${Date.now()}`;
        const endNodeId = `end_${Date.now()}`;

        const startNode: WorkflowNode = {
          nodeId: startNodeId,
          type: 'start',
          label: 'Start',
          data: {},
          position: { x: 100, y: 100 }
        };

        const endNode: WorkflowNode = {
          nodeId: endNodeId,
          type: 'end',
          label: 'End',
          data: {},
          position: { x: 100, y: 300 }
        };

        const workflowName = detectedType === 'openapi'
          ? `Imported OpenAPI - ${new Date().toLocaleString()}`
          : `Imported HAR - ${new Date().toLocaleString()}`;

        const payload: CreateWorkflowPayload = {
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
        };

        const createResponse = await authenticatedFetch(
          `${API_BASE_URL}/api/workflows`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }
        );

        if (createResponse.ok) {
          setMessage({
            type: 'success',
            title: 'Import Successful',
            text: `Workflow created in collection with ${nodeTemplates.length} imported templates.`,
          });

          setUploadedFile(null);
          setPastedJson('');
          setValidation(null);
          setSelectedTargetCollection(null);

          useSidebarStore.getState().signalWorkflowsRefresh();

          setTimeout(() => {
            onClose();
          }, 2000);
        } else {
          const error: { detail?: unknown } = await createResponse.json();
          setMessage({
            type: 'error',
            title: 'Create Failed',
            text: formatErrorMessage(error.detail) || 'Failed to create workflow with templates',
          });
        }
      } else {
        const error: { detail?: unknown } = await parseResponse.json();
        setMessage({
          type: 'error',
          title: 'Parse Failed',
          text: formatErrorMessage(error.detail) || 'Failed to parse import file',
        });
      }
    } catch (error: unknown) {
      const err = error as Error;
      setMessage({
        type: 'error',
        title: 'Import Error',
        text: err.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportCurlToCollection = async (): Promise<void> => {
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
      params.append('sanitize', String(sanitize));
      params.append('workflowId', selectedTargetCollection);

      const response = await authenticatedFetch(`${API_BASE_URL}/api/workflows/import/curl?${params}`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData: { detail?: string } = await response.json();
        throw new Error(errorData.detail || 'Import failed');
      }

      await response.json();

      setMessage({
        type: 'success',
        title: 'Import Successful',
        text: `cURL command imported and assigned to collection.`,
      });

      setPastedJson('');
      setValidation(null);
      setSelectedTargetCollection(null);

      useSidebarStore.getState().signalCollectionsRefresh();

      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (error: unknown) {
      const err = error as Error;
      setMessage({
        type: 'error',
        title: 'Import Error',
        text: err.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.currentTarget.classList.add('border-blue-500', 'bg-blue-50');
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50');
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0] as File);
    }
  };

  const handleFileSelect = (file: File): void => {
    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
      if (e.target?.result) {
        setUploadedFile(e.target.result as string);
        setPastedJson('');
        setValidation(null);
      }
    };
    reader.readAsText(file);
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const tabButtonClasses = (tab: TabId): string => {
    const base = 'flex-1 px-4 py-3 font-medium text-center transition-colors flex items-center justify-center gap-2';
    if (activeTab === tab) {
      return `${base} border-b-2 border-blue-500 text-blue-600 dark:text-blue-400 bg-surface-raised dark:bg-surface-dark-raised`;
    }
    return `${base} text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark`;
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-surface-raised dark:bg-surface-dark-raised rounded-lg shadow-2xl w-full max-w-2xl max-h-screen overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-border dark:border-border-dark">
          <h2 className="text-2xl font-bold text-text-primary dark:text-text-primary-dark">
            {activeTab === 'export' && `Export Collection: ${collectionName}`}
            {activeTab === 'import-collection' && `Import Collection`}
            {activeTab === 'import-workflows' && `Import Workflow to Collection`}
            {activeTab === 'import-har' && `Import HAR File to Collection`}
            {activeTab === 'import-openapi' && `Import OpenAPI to Collection`}
            {activeTab === 'import-curl' && `Import cURL to Collection`}
          </h2>
          <IconButton
            onClick={onClose}
            tooltip="Close"
            variant="ghost"
          >
            <X size={24} />
          </IconButton>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
          <button
            onClick={() => {
              setActiveTab('export');
              setMessage(null);
              setValidation(null);
            }}
            className={tabButtonClasses('export')}
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
            className={tabButtonClasses('import-collection')}
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
            className={tabButtonClasses('import-workflows')}
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
            className={tabButtonClasses('import-har')}
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
            className={tabButtonClasses('import-openapi')}
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
            className={tabButtonClasses('import-curl')}
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
              <div className="bg-primary/5 dark:bg-primary/10 p-4 rounded-lg">
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                  Export this collection with all workflows and environments
                </p>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeEnvironments}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setIncludeEnvironments(e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-text-primary dark:text-text-primary-dark">Include Environments</span>
                </label>
              </div>

              <Button
                onClick={handleExport}
                disabled={isLoading}
                fullWidth
                icon={<Download size={18} />}
              >
                {isLoading ? 'Exporting...' : 'Download Collection Bundle'}
              </Button>
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
                className="border-2 border-dashed border-border dark:border-border-dark rounded-lg p-6 text-center hover:bg-surface dark:hover:bg-surface-dark transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={32} className="mx-auto mb-2 text-text-muted dark:text-text-muted-dark" />
                <p className="font-medium text-text-primary dark:text-text-primary-dark">Drag & drop collection bundle</p>
                <p className="text-sm text-text-muted dark:text-text-muted-dark">or click to browse</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".awecollection,.json"
                  onChange={handleFileInputChange}
                  className="hidden"
                />
              </div>

              {uploadedFile && (
                <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg flex items-center gap-2 text-status-success dark:text-status-success-dark">
                  <CheckCircle size={18} />
                  <span className="text-sm">File loaded successfully</span>
                </div>
              )}

              {/* Paste JSON */}
              <div>
                <label className="block text-sm font-medium mb-2 text-text-primary dark:text-text-primary-dark">
                  Or paste JSON:
                </label>
                <TextArea
                  value={pastedJson}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
                    setPastedJson(e.target.value);
                    setUploadedFile(null);
                  }}
                  placeholder="Paste collection JSON here..."
                  className="w-full h-32 resize-none"
                  rows={6}
                />
              </div>

              {/* Validation */}
              {validation && (
                <div className="bg-surface dark:bg-surface-dark p-4 rounded-lg space-y-2">
                  <h4 className="font-medium text-text-primary dark:text-text-primary-dark">Validation Results</h4>
                  {validation.valid ? (
                    <p className="text-status-success dark:text-status-success-dark text-sm flex items-center gap-2">
                      <CheckCircle size={16} /> Valid collection bundle
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {validation.errors.map((err: string, i: number) => (
                        <p key={i} className="text-status-error dark:text-status-error-dark text-sm flex items-center gap-2">
                          <AlertCircle size={14} /> {err}
                        </p>
                      ))}
                    </div>
                  )}

                  {validation.warnings && validation.warnings.length > 0 && (
                    <div className="space-y-1">
                      {validation.warnings.map((warn: string, i: number) => (
                        <p key={i} className="text-yellow-600 dark:text-yellow-400 text-sm flex items-center gap-2">
                          <Info size={14} /> {warn}
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-text-secondary dark:text-text-secondary-dark">
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
                  <span className="text-text-primary dark:text-text-primary-dark">Create New Collection</span>
                </label>

                {createNewCollection && (
                  <Input
                    type="text"
                    value={newCollectionName}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setNewCollectionName(e.target.value)}
                    placeholder="Collection name..."
                    className="ml-7"
                  />
                )}

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    checked={!createNewCollection}
                    onChange={() => setCreateNewCollection(false)}
                    className="w-4 h-4"
                  />
                  <span className="text-text-primary dark:text-text-primary-dark">Import to Existing Collection</span>
                </label>

                {!createNewCollection && (
                  <select
                    value={selectedTargetCollection || ''}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => setSelectedTargetCollection(e.target.value)}
                    className="ml-7 w-full px-3 py-2 border border-border dark:border-border-dark rounded-lg bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark"
                  >
                    <option value="">Select collection...</option>
                    {collections.map((c: CollectionWithWorkflowCount) => (
                      <option key={c.collectionId} value={c.collectionId}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <Button
                  onClick={handleValidateCollectionImport}
                  disabled={isLoading || (!uploadedFile && !pastedJson)}
                  variant="secondary"
                  className="flex-1"
                >
                  Validate
                </Button>
                <Button
                  onClick={handleImportCollection}
                  disabled={
                    isLoading || !validation?.valid || (!createNewCollection && !selectedTargetCollection)
                  }
                  variant="primary"
                  icon={<Upload size={18} />}
                  className="flex-1"
                >
                  {isLoading ? 'Importing...' : 'Import Collection'}
                </Button>
              </div>
            </div>
          )}

          {/* Import Workflows Tab */}
          {activeTab === 'import-workflows' && (
            <div className="space-y-4">
              <div className="bg-primary/5 dark:bg-primary/10 p-4 rounded-lg">
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                  Import individual workflows, HAR files, or OpenAPI specs to this collection
                </p>
              </div>

              {/* Collection Selector */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-text-primary dark:text-text-primary-dark">
                  Select Collection
                </label>
                <select
                  value={selectedTargetCollection || ''}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setSelectedTargetCollection(e.target.value || null)}
                  className="w-full px-4 py-2 border border-border dark:border-border-dark rounded-lg bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">-- Choose a collection --</option>
                  {collections.map((col: CollectionWithWorkflowCount) => (
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
                className="border-2 border-dashed border-border dark:border-border-dark rounded-lg p-6 text-center hover:bg-surface dark:hover:bg-surface-dark transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={32} className="mx-auto mb-2 text-text-muted dark:text-text-muted-dark" />
                <p className="font-medium text-text-primary dark:text-text-primary-dark">Drag & drop file or click to browse</p>
                <p className="text-xs text-text-muted dark:text-text-muted-dark">
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
                <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg flex items-center gap-2 text-status-success dark:text-status-success-dark">
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
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setSanitize(e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-text-primary dark:text-text-primary-dark">Sanitize sensitive headers</span>
                </label>
              </div>

              {/* Action button */}
              <Button
                onClick={handleImportWorkflowToCollection}
                disabled={isLoading || !uploadedFile || !selectedTargetCollection}
                fullWidth
                variant="primary"
                icon={<Upload size={18} />}
                title={!selectedTargetCollection ? 'Please select a collection' : ''}
              >
                {isLoading ? 'Importing...' : 'Import to Collection'}
              </Button>
            </div>
          )}

          {/* Import HAR Tab */}
          {activeTab === 'import-har' && (
            <div className="space-y-4">
              <div className="bg-primary/5 dark:bg-primary/10 p-4 rounded-lg">
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                  Import individual workflows, HAR files, or OpenAPI specs to this collection
                </p>
              </div>

              {/* Collection Selector */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-text-primary dark:text-text-primary-dark">
                  Select Collection
                </label>
                <select
                  value={selectedTargetCollection || ''}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setSelectedTargetCollection(e.target.value || null)}
                  className="w-full px-4 py-2 border border-border dark:border-border-dark rounded-lg bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">-- Choose a collection --</option>
                  {collections.map((col: CollectionWithWorkflowCount) => (
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
                className="border-2 border-dashed border-border dark:border-border-dark rounded-lg p-6 text-center hover:bg-surface dark:hover:bg-surface-dark transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={32} className="mx-auto mb-2 text-text-muted dark:text-text-muted-dark" />
                <p className="font-medium text-text-primary dark:text-text-primary-dark">Drag & drop file or click to browse</p>
                <p className="text-xs text-text-muted dark:text-text-muted-dark">
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
                <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg flex items-center gap-2 text-status-success dark:text-status-success-dark">
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
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setSanitize(e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-text-primary dark:text-text-primary-dark">Sanitize sensitive headers</span>
                </label>
              </div>

              {/* Action button */}
              <Button
                onClick={handleImportWorkflowToCollection}
                disabled={isLoading || !uploadedFile || !selectedTargetCollection}
                fullWidth
                variant="primary"
                icon={<Upload size={18} />}
                title={!selectedTargetCollection ? 'Please select a collection' : ''}
              >
                {isLoading ? 'Importing...' : 'Import to Collection'}
              </Button>
            </div>
          )}

          {/* Import OpenAPI Tab */}
          {activeTab === 'import-openapi' && (
            <div className="space-y-4">
              <div className="bg-primary/5 dark:bg-primary/10 p-4 rounded-lg">
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                  Import individual workflows, HAR files, or OpenAPI specs to this collection
                </p>
              </div>

              {/* Collection Selector */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-text-primary dark:text-text-primary-dark">
                  Select Collection
                </label>
                <select
                  value={selectedTargetCollection || ''}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setSelectedTargetCollection(e.target.value || null)}
                  className="w-full px-4 py-2 border border-border dark:border-border-dark rounded-lg bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">-- Choose a collection --</option>
                  {collections.map((col: CollectionWithWorkflowCount) => (
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
                className="border-2 border-dashed border-border dark:border-border-dark rounded-lg p-6 text-center hover:bg-surface dark:hover:bg-surface-dark transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={32} className="mx-auto mb-2 text-text-muted dark:text-text-muted-dark" />
                <p className="font-medium text-text-primary dark:text-text-primary-dark">Drag & drop file or click to browse</p>
                <p className="text-xs text-text-muted dark:text-text-muted-dark">
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
                <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg flex items-center gap-2 text-status-success dark:text-status-success-dark">
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
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setSanitize(e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-text-primary dark:text-text-primary-dark">Sanitize sensitive headers</span>
                </label>
              </div>

              {/* Action button */}
              <Button
                onClick={handleImportWorkflowToCollection}
                disabled={isLoading || !uploadedFile || !selectedTargetCollection}
                fullWidth
                variant="primary"
                icon={<Upload size={18} />}
                title={!selectedTargetCollection ? 'Please select a collection' : ''}
              >
                {isLoading ? 'Importing...' : 'Import to Collection'}
              </Button>
            </div>
          )}

          {/* Import cURL Tab */}
          {activeTab === 'import-curl' && (
            <div className="space-y-4">
              <div className="bg-primary/5 dark:bg-primary/10 p-4 rounded-lg">
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                  Import cURL commands to create API test workflows in this collection
                </p>
              </div>

              {/* Collection Selector */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-text-primary dark:text-text-primary-dark">
                  Select Collection
                </label>
                <select
                  value={selectedTargetCollection || ''}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setSelectedTargetCollection(e.target.value || null)}
                  className="w-full px-4 py-2 border border-border dark:border-border-dark rounded-lg bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">-- Choose a collection --</option>
                  {collections.map((col: CollectionWithWorkflowCount) => (
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
                <label className="block text-sm font-medium text-text-primary dark:text-text-primary-dark">
                  cURL Command(s)
                </label>
                <TextArea
                  value={pastedJson}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setPastedJson(e.target.value)}
                  placeholder="Paste your cURL command here (single or multiple commands separated by &&)"
                  className="font-mono text-sm"
                  rows={6}
                />
              </div>

              {/* Options */}
              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sanitize}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setSanitize(e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-text-primary dark:text-text-primary-dark">Sanitize sensitive headers</span>
                </label>
              </div>

              {/* Action button */}
              <Button
                onClick={handleImportCurlToCollection}
                disabled={isLoading || !pastedJson.trim() || !selectedTargetCollection}
                fullWidth
                variant="primary"
                icon={<Upload size={18} />}
                title={!selectedTargetCollection ? 'Please select a collection' : ''}
              >
                {isLoading ? 'Importing...' : 'Import to Collection'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CollectionExportImport;
