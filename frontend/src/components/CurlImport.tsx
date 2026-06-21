import { useState, useEffect, type ChangeEvent, type DragEvent } from 'react';
import { Upload, FileText, AlertCircle, CheckCircle, X, Copy, Trash2 } from 'lucide-react';
import useCanvasStore from '../stores/CanvasStore';
import { Button } from './atoms/Button';
import { TextArea } from './atoms/TextArea';
import { IconButton } from './atoms/IconButton';
import { authenticatedFetch } from '../utils/authenticatedApi';
import { useScopeContext } from '../hooks/useScopeContext';
import { workflowsUrl, workflowImportCurlUrl } from '../utils/scopedApi';

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
  const { workspaceId } = useScopeContext();
  const [curlInput, setCurlInput] = useState<string>('');
  const [sanitize, setSanitize] = useState<boolean>(true);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [importing, setImporting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(currentWorkflowId || '');
  const [loadingWorkflows, setLoadingWorkflows] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      try {
        const response = await authenticatedFetch(workflowsUrl(workspaceId || '', { limit: 100 }));
        if (response.ok) {
          const data = await response.json();
          setWorkflows(data.workflows || []);
        }
      } catch (err) {
        console.error('Error fetching workflows:', err);
      } finally {
        setLoadingWorkflows(false);
      }
    })();
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

      const response = await authenticatedFetch(`${workflowImportCurlUrl(workspaceId || '', true)}?${params}`, {
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

      const response = await authenticatedFetch(`${workflowImportCurlUrl(workspaceId || '')}?${params}`, {
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
    <>
      <button type="button" aria-label="Close curl import" className="fixed inset-0 z-40 cursor-default bg-[var(--aw-surface)]/60 dark:bg-[var(--aw-surface)]/80" onClick={onClose} />
      <div className="relative z-50 bg-surface-raised dark:bg-surface-dark-raised rounded border border-border dark:border-border-dark w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
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
            className={`border border-dashed rounded p-8 text-center transition-colors ${
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
              className="inline-block px-4 py-2 bg-primary text-white rounded hover:bg-primary-hover cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
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
                variant="outline"
                size="sm"
                icon={<Trash2 className="w-4 h-4" />}
              >
                Clear
              </Button>
              <Button
                onClick={handlePasteSample}
                variant="outline"
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
            <div className="space-y-3 p-3 bg-surface dark:bg-surface-dark rounded border border-border dark:border-border-dark">
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
                  className="w-full px-3 py-2 border border-border dark:border-border-dark rounded bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
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
                  className="w-4 h-4 text-[var(--aw-primary)] border-border dark:border-border-dark rounded focus:ring-[var(--aw-primary)]"
                />
                <span className="text-sm text-text-primary dark:text-text-primary-dark">
                  Sanitize sensitive headers (API keys, tokens, etc.)
                </span>
              </label>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-[var(--aw-status-error)]/5 dark:bg-[var(--aw-status-error)]/10 border border-[var(--aw-status-error)]/20 dark:border-[var(--aw-status-error)]/30 rounded p-4">
              <div className="flex items-start">
                <AlertCircle className="w-5 h-5 text-status-error dark:text-status-error-dark mr-2 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-status-error dark:text-status-error-dark">{error}</p>
              </div>
            </div>
          )}

          {/* Dry Run Result */}
          {dryRunResult && (
            <div className="bg-[var(--aw-status-info)]/5 dark:bg-[var(--aw-status-info)]/10 border border-[var(--aw-status-info)]/20 dark:border-[var(--aw-status-info)]/30 rounded p-4">
              <div className="flex items-start">
                <CheckCircle className="w-5 h-5 text-[var(--aw-status-info)] dark:text-[var(--aw-status-info)] mr-2 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-medium text-text-primary dark:text-text-primary-dark mb-2">
                    Preview: {dryRunResult.stats.totalRequests} request(s)
                  </h3>
                  <div className="text-sm text-[var(--aw-status-info)] dark:text-[var(--aw-status-info)] space-y-1">
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
            variant="outline"
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
            variant="outline"
          >
            Close
          </Button>
        </div>
      </div>
    </>
  );
}

export default CurlImport;
