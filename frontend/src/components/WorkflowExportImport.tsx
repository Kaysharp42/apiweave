import { useState, type ChangeEvent } from 'react';
import { Download, Upload, FileText, AlertCircle, CheckCircle, X, AlertTriangle } from 'lucide-react';
import { resolveWorkflowExportImportInitialTab } from '../utils/workflowExportImportTabs';
import { Button } from './atoms/Button';
import { Input } from './atoms/Input';
import { TextArea } from './atoms/TextArea';
import { IconButton } from './atoms/IconButton';

export interface DryRunStats {
  nodes: number;
  edges: number;
  variables: number;
  secretReferences: number;
}

export interface DryRunResult {
  valid: boolean;
  stats?: DryRunStats;
  errors?: string[];
  warnings?: string[];
}

export interface ImportResult {
  workflowId: string;
  secretReferences?: string[];
}

export type WorkflowExportImportTab = 'export' | 'import';

export interface WorkflowExportImportProps {
  workflowId?: string | null;
  workflowName?: string | null;
  onClose: () => void;
  onImportSuccess?: (workflowId: string) => void;
  initialTab?: WorkflowExportImportTab;
  mode?: string;
}

export function WorkflowExportImport({
  workflowId,
  workflowName,
  onClose,
  onImportSuccess,
  initialTab,
  mode,
}: WorkflowExportImportProps) {
  const [activeTab, setActiveTab] = useState<WorkflowExportImportTab>(() =>
    resolveWorkflowExportImportInitialTab({ initialTab, mode }),
  );
  const [includeEnvironment, setIncludeEnvironment] = useState<boolean>(true);
  const [exporting, setExporting] = useState<boolean>(false);
  const [importing, setImporting] = useState<boolean>(false);
  const [importJson, setImportJson] = useState<string>('');
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createMissingEnvs, setCreateMissingEnvs] = useState<boolean>(true);

  const handleExport = async (): Promise<void> => {
    if (!workflowId) {
      setError('Select a workflow from the list to export.');
      return;
    }

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
    } catch (err: unknown) {
      console.error('Export error:', err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setExporting(false);
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file) {
      setImportJson('');
      setError(null);
      setDryRunResult(null);

      const reader = new FileReader();
      reader.onload = (event: ProgressEvent<FileReader>) => {
        try {
          const result = event.target?.result;
          if (typeof result === 'string') {
            const json = JSON.parse(result);
            setImportJson(JSON.stringify(json, null, 2));
          }
        } catch {
          setError('Invalid JSON file');
        }
      };
      reader.readAsText(file);
    }
  };

  const handleDryRun = async (): Promise<void> => {
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
    } catch (err: unknown) {
      console.error('Dry run error:', err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    }
  };

  const handleImport = async (): Promise<void> => {
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

      if (onImportSuccess) {
        setTimeout(() => {
          onImportSuccess(result.workflowId);
        }, 1500);
      }
    } catch (err: unknown) {
      console.error('Import error:', err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div 
      role="button"
      tabIndex={0}
      className="fixed inset-0 bg-slate-950/50 flex items-center justify-center z-50"
      onClick={(e: React.MouseEvent<HTMLDivElement>) => {
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
      <div className="bg-surface-raised dark:bg-surface-dark-raised rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border dark:border-border-dark">
          <h2 className="text-xl font-semibold text-text-primary dark:text-text-primary-dark">
            Workflow Export / Import
          </h2>
          <IconButton
            onClick={onClose}
            variant="ghost"
            size="sm"
            tooltip="Close"
          >
            <X className="w-5 h-5" />
          </IconButton>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border dark:border-border-dark">
          <button
            type="button"
            onClick={() => workflowId && setActiveTab('export')}
            disabled={!workflowId}
            title={!workflowId ? 'Select a workflow from the list to export' : undefined}
            className={`px-6 py-3 font-medium ${
              activeTab === 'export'
                ? 'border-b-2 border-primary text-primary dark:text-primary-dark'
                : 'text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark'
            } ${!workflowId ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Download className="w-4 h-4 inline mr-2" />
            Export
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('import')}
            className={`px-6 py-3 font-medium ${
              activeTab === 'import'
                ? 'border-b-2 border-primary text-primary dark:text-primary-dark'
                : 'text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark'
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
                <h3 className="text-lg font-medium text-text-primary dark:text-text-primary-dark mb-2">
                  Export Workflow Bundle
                </h3>
                <p className="text-sm text-text-secondary dark:text-text-secondary-dark mb-4">
                  Download a complete workflow bundle including nodes, edges, variables, and
                  optional environment configuration.
                </p>
              </div>

              <div className="bg-primary/5 dark:bg-primary/10 border border-primary/20 dark:border-primary/30 rounded-lg p-4">
                <div className="flex items-start">
                  <AlertCircle className="w-5 h-5 text-primary dark:text-primary-dark mr-3 mt-0.5" />
                  <div className="text-sm text-text-primary dark:text-text-primary-dark">
                    <p className="font-medium mb-1">Secret values are never exported</p>
                    <p>
                      Any detected secrets (API keys, tokens, passwords) will be replaced with{' '}
                      <code className="bg-primary/5 dark:bg-primary/10 px-1 rounded">&lt;SECRET&gt;</code>{' '}
                      placeholders. You'll need to re-enter these values after importing.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={includeEnvironment}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setIncludeEnvironment(e.target.checked)}
                    className="w-4 h-4 text-primary border-border dark:border-border-dark rounded focus:ring-primary"
                  />
                  <span className="text-sm text-text-primary dark:text-text-primary-dark">
                    Include referenced environment (if any)
                  </span>
                </label>
              </div>

              {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-sm text-status-error dark:text-status-error-dark">
                  {error}
                </div>
              )}

              <Button
                onClick={handleExport}
                disabled={exporting}
                loading={exporting}
                fullWidth
                icon={<Download className="w-4 h-4" />}
              >
                {exporting ? 'Exporting...' : 'Download Workflow Bundle'}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-medium text-text-primary dark:text-text-primary-dark mb-2">
                  Import Workflow Bundle
                </h3>
                <p className="text-sm text-text-secondary dark:text-text-secondary-dark mb-4">
                  Upload a workflow bundle JSON file or paste the JSON content directly.
                </p>
              </div>

              {/* File upload */}
              <div>
                <label htmlFor="workflow-bundle-file" className="block text-sm font-medium text-text-primary dark:text-text-primary-dark mb-2">
                  Upload File
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    id="workflow-bundle-file"
                    type="file"
                    accept=".json"
                    onChange={handleFileSelect}
                    className="block w-full text-sm text-text-muted dark:text-text-muted-dark
                      file:mr-4 file:py-2 file:px-4
                      file:rounded-lg file:border-0
                      file:text-sm file:font-medium
                      file:bg-primary/5 file:text-primary
                      hover:file:bg-primary/10
                      dark:file:bg-primary/10 dark:file:text-primary-dark
                      dark:hover:file:bg-primary/20"
                  />
                </div>
              </div>

              {/* Or paste JSON */}
              <div>
                <label htmlFor="workflow-bundle-json" className="block text-sm font-medium text-text-primary dark:text-text-primary-dark mb-2">
                  Or Paste JSON
                </label>
                <TextArea
                  id="workflow-bundle-json"
                  value={importJson}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
                    setImportJson(e.target.value);
                    setError(null);
                    setDryRunResult(null);
                  }}
                  placeholder='{"workflow": {...}, "environments": [...], ...}'
                  className="w-full h-32 px-3 py-2 border border-border dark:border-border-dark rounded-lg
                    bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark text-sm font-mono
                    focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Options */}
              <div className="space-y-3">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={createMissingEnvs}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setCreateMissingEnvs(e.target.checked)}
                    className="w-4 h-4 text-primary border-border dark:border-border-dark rounded focus:ring-primary"
                  />
                  <span className="text-sm text-text-primary dark:text-text-primary-dark">
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
                      <CheckCircle className="w-5 h-5 text-status-success dark:text-status-success-dark mr-2" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-status-error dark:text-status-error-dark mr-2" />
                    )}
                    <div className="flex-1">
                      <p className={`font-medium ${
                        dryRunResult.valid
                          ? 'text-status-success dark:text-status-success-dark'
                          : 'text-status-error dark:text-status-error-dark'
                      }`}>
                        {dryRunResult.valid ? 'Bundle is valid!' : 'Validation failed'}
                      </p>
                      
                      {dryRunResult.stats && (
                        <div className="mt-2 text-sm text-text-primary dark:text-text-primary-dark">
                          <p>Nodes: {dryRunResult.stats.nodes}</p>
                          <p>Edges: {dryRunResult.stats.edges}</p>
                          <p>Variables: {dryRunResult.stats.variables}</p>
                          {dryRunResult.stats.secretReferences > 0 && (
                            <p className="text-yellow-700 dark:text-yellow-400 flex items-center gap-2">
                              <AlertTriangle className="w-4 h-4" />
                              <span>{dryRunResult.stats.secretReferences} secret(s) need to be re-entered</span>
                            </p>
                          )}
                        </div>
                      )}

                      {dryRunResult.errors && dryRunResult.errors.length > 0 && (
                        <ul className="mt-2 text-sm text-status-error dark:text-status-error-dark list-disc list-inside">
                          {dryRunResult.errors.map((err: string) => (
                            <li key={err}>{err}</li>
                          ))}
                        </ul>
                      )}

                      {dryRunResult.warnings && dryRunResult.warnings.length > 0 && (
                        <ul className="mt-2 text-sm text-yellow-700 dark:text-yellow-400 list-disc list-inside">
                          {dryRunResult.warnings.map((warn: string) => (
                            <li key={warn}>{warn}</li>
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
                    <CheckCircle className="w-5 h-5 text-status-success dark:text-status-success-dark mr-2" />
                    <div>
                      <p className="font-medium text-status-success dark:text-status-success-dark">
                        Import successful!
                      </p>
                      <p className="text-sm text-status-success dark:text-status-success-dark mt-1">
                        Workflow ID: {importResult.workflowId}
                      </p>
                      {importResult.secretReferences && importResult.secretReferences.length > 0 && (
                        <p className="text-sm text-yellow-700 dark:text-yellow-400 mt-2 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4" />
                          <span>Remember to re-enter {importResult.secretReferences.length} secret value(s)</span>
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-sm text-status-error dark:text-status-error-dark">
                  {error}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-3">
                <Button
                  onClick={handleDryRun}
                  disabled={!importJson}
                  variant="secondary"
                  fullWidth
                  icon={<FileText className="w-4 h-4" />}
                >
                  Validate
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={importing || !importJson || (dryRunResult !== null && !dryRunResult.valid)}
                  loading={importing}
                  variant="primary"
                  fullWidth
                  icon={<Upload className="w-4 h-4" />}
                >
                  {importing ? 'Importing...' : 'Import Workflow'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default WorkflowExportImport;
