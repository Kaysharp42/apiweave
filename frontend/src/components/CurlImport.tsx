import { useState, useEffect, useCallback, type ChangeEvent, type DragEvent } from 'react';
import { Upload, FileText, AlertCircle, CheckCircle, X, Copy, Trash2 } from 'lucide-react';
import API_BASE_URL from '../utils/api';
import useCanvasStore from '../stores/CanvasStore';
import { Button } from './atoms/Button';
import { TextArea } from './atoms/TextArea';
import { IconButton } from './atoms/IconButton';
import { authenticatedFetch } from '../utils/authenticatedApi';

interface Workflow {
  workflowId: string;
  name: string;
  nodes?: unknown[];
}

interface DryRunResult {
  stats: {
    totalRequests: number;
  };
  workflow: {
    name: string;
    nodeCount: number;
    edgeCount: number;
  };
}

interface CurlImportProps {
  onClose: () => void;
  onImportSuccess?: (workflowId: string) => void;
  currentWorkflowId?: string;
}

export function CurlImport({ onClose, onImportSuccess, currentWorkflowId }: CurlImportProps) {
  const [curlInput, setCurlInput] = useState<string>('');
  const [sanitize, setSanitize] = useState<boolean>(true);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [importing, setImporting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(currentWorkflowId || '');
  const [loadingWorkflows, setLoadingWorkflows] = useState<boolean>(true);

  const fetchWorkflows = useCallback(async () => {
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/api/workflows?limit=100`);
      if (response.ok) {
        const data = await response.json();
        setWorkflows(data.workflows || []);
      }
    } catch (err) {
      console.error('Error fetching workflows:', err);
    } finally {
      setLoadingWorkflows(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkflows();
  }, []);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const content = event.target?.result;
          if (typeof content === 'string') {
            setCurlInput(content);
          }
          setError(null);
          setDryRunResult(null);
        } catch (err) {
          if (err instanceof Error) {
            setError('Failed to read file: ' + err.message);
          }
        }
      };
      reader.readAsText(file);
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const content = event.target?.result;
          if (typeof content === 'string') {
            setCurlInput(content);
          }
          setError(null);
          setDryRunResult(null);
        } catch (err) {
          if (err instanceof Error) {
            setError('Failed to read file: ' + err.message);
          }
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
      params.append('sanitize', String(sanitize));

      const response = await authenticatedFetch(`${API_BASE_URL}/api/workflows/import/curl/dry-run?${params}`, {
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
      if (err instanceof Error) {
        setError(err.message);
      }
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

    try {
      const params = new URLSearchParams();
      params.append('curl_command', curlInput);
      params.append('sanitize', String(sanitize));
      if (selectedWorkflowId) {
        params.append('workflowId', selectedWorkflowId);
      }

      const response = await authenticatedFetch(`${API_BASE_URL}/api/workflows/import/curl?${params}`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Import failed');
      }

      const data = await response.json();

      if (selectedWorkflowId) {
        useCanvasStore.getState().signalWorkflowReload(data.workflowId);
      }

      if (onImportSuccess) {
        onImportSuccess(data.workflowId);
      }
      onClose();
    } catch (err) {
      console.error('Import error:', err);
      if (err instanceof Error) {
        setError(err.message);
      }
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
      role="button"
      tabIndex={0}
      className="fixed inset-0 bg-slate-950/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="bg-surface-raised dark:bg-surface-dark-raised rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border dark:border-border-dark">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary dark:text-primary-dark" />
            <h2 className="text-lg font-semibold text-text-primary dark:text-text-primary-dark">
              Import curl Commands
            </h2>
          </div>
          <IconButton
            onClick={onClose}
            tooltip="Close"
            variant="ghost"
          >
            <X className="w-5 h-5" />
          </IconButton>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Info */}
          <div>
            <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
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
                ? 'border-primary/20 dark:border-primary/30 bg-primary/5 dark:bg-primary/10'
                : 'border-border dark:border-border-dark'
            }`}
          >
            <Upload className="w-12 h-12 mx-auto mb-4 text-text-muted dark:text-text-muted-dark" />
            <p className="text-sm text-text-secondary dark:text-text-secondary-dark mb-2">
              Drag & drop a text file with curl commands here, or click to browse
            </p>
            <input
              type="file"
              accept=".txt,.sh,.curl"
              onChange={handleFileSelect}
              className="hidden"
              id="curl-file-input"
            />
            <label
              htmlFor="curl-file-input"
              className="inline-block px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover cursor-pointer"
            >
              Choose File
            </label>
          </div>

          {/* Text Input Area */}
          <div>
                <label htmlFor="curl-paste-area" className="block text-sm font-medium text-text-primary dark:text-text-primary-dark mb-2">
                  Or paste curl commands here:
                </label>
                <TextArea
                  id="curl-paste-area"
                  value={curlInput}
              onChange={(e) => setCurlInput(e.target.value)}
              placeholder={`curl -X GET "https://api.example.com/users" \\
  -H "Authorization: Bearer token123" \\
  -H "Content-Type: application/json"

curl -X POST "https://api.example.com/users" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"John","email":"john@example.com"}'`}
              className="w-full h-40 font-mono text-sm"
            />
            <div className="mt-2 flex gap-2">
              <Button
                onClick={handleClear}
                disabled={!curlInput}
                variant="secondary"
                size="sm"
                icon={<Trash2 className="w-4 h-4" />}
              >
                Clear
              </Button>
              <Button
                onClick={handlePasteSample}
                variant="secondary"
                intent="info"
                size="sm"
                icon={<Copy className="w-4 h-4" />}
              >
                Paste Sample
              </Button>
            </div>
          </div>

          {/* Options */}
          {curlInput && (
            <div className="space-y-3 p-3 bg-surface dark:bg-surface-dark rounded-lg">
              {/* Workflow Selection */}
              <div>
                <label htmlFor="curl-destination-workflow" className="block text-sm font-medium text-text-primary dark:text-text-primary-dark mb-2">
                  Destination Workflow
                </label>
                <select
                  id="curl-destination-workflow"
                  value={selectedWorkflowId}
                  onChange={(e) => setSelectedWorkflowId(e.target.value)}
                  disabled={loadingWorkflows}
                  className="w-full px-3 py-2 border border-border dark:border-border-dark rounded-lg bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
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
                <p className="text-xs text-text-secondary dark:text-text-secondary-dark mt-1 flex items-center gap-1">
                  {selectedWorkflowId ? (
                    <>
                      <CheckCircle className="w-4 h-4 text-status-success dark:text-status-success-dark" />
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
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sanitize}
                  onChange={(e) => setSanitize(e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-border dark:border-border-dark rounded focus:ring-blue-500"
                />
                <span className="text-sm text-text-primary dark:text-text-primary-dark">
                  Sanitize sensitive headers (API keys, tokens, etc.)
                </span>
              </label>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <div className="flex items-start">
                <AlertCircle className="w-5 h-5 text-status-error dark:text-status-error-dark mr-2 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-status-error dark:text-status-error-dark">{error}</p>
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
        <div className="flex gap-3 p-4 border-t border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
          <Button
            onClick={handlePreview}
            disabled={!curlInput || isLoading}
            variant="secondary"
            fullWidth
            loading={isLoading}
            icon={!isLoading ? <FileText className="w-4 h-4" /> : undefined}
          >
            {isLoading ? 'Previewing...' : 'Preview'}
          </Button>
          <Button
            onClick={handleImport}
            disabled={importing || !curlInput}
            variant="primary"
            intent="info"
            fullWidth
            loading={importing}
            icon={!importing ? <Upload className="w-4 h-4" /> : undefined}
          >
            {importing ? 'Importing...' : 'Import as Workflow'}
          </Button>
          <Button
            onClick={onClose}
            variant="secondary"
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

export default CurlImport;
