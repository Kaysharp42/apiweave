import { useState, type ChangeEvent } from 'react';
import { Download, Upload, FileText, AlertCircle, CheckCircle, AlertTriangle } from 'lucide-react';
import { resolveWorkflowExportImportInitialTab } from '../utils/workflowExportImportTabs';
import { Button } from './atoms/Button';
import { Input } from './atoms/Input';
import { TextArea } from './atoms/TextArea';
import { Modal } from './molecules/Modal';
import { useScopeContext } from '../hooks/useScopeContext';
import { authenticatedFetch } from '../utils/authenticatedApi';
import { workflowExportUrl, workflowImportUrl, workflowImportDryRunUrl } from '../utils/scopedApi';
import type { WorkflowExportImportTab } from '../types/WorkflowExportImportTab';
import type { WorkflowExportImportProps } from '../types/WorkflowExportImportProps';
import type { DryRunResult } from '../types/DryRunResult';
import type { ImportResult } from '../types/ImportResult';

export function WorkflowExportImport({
  workflowId,
  workflowName,
  onClose,
  onImportSuccess,
  initialTab,
  mode,
}: WorkflowExportImportProps) {
  const { workspaceId } = useScopeContext();
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
      const response = await authenticatedFetch(
        workflowExportUrl(workspaceId || '', workflowId, includeEnvironment),
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

      const response = await authenticatedFetch(workflowImportDryRunUrl(workspaceId || ''), {
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

      const response = await authenticatedFetch(workflowImportUrl(workspaceId || ''), {
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
    <Modal isOpen onClose={onClose} title="Workflow Export / Import" size="xl" scrollable>
      {/* Tabs */}
      <div className="flex border-b border-border dark:border-border-dark">
        <button
          type="button"
          onClick={() => workflowId && setActiveTab('export')}
          disabled={!workflowId}
          title={!workflowId ? 'Select a workflow from the list to export' : undefined}
          className={`px-6 py-3 font-medium cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] ${
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
          className={`px-6 py-3 font-medium cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] ${
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

            <div className="bg-surface-overlay dark:bg-surface-dark-overlay border border-border dark:border-border-dark rounded p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-[var(--aw-primary)] flex-shrink-0 mt-0.5" />
                <div className="text-sm text-text-primary dark:text-text-primary-dark">
                  <p className="font-medium mb-1">Secret values are never exported</p>
                  <p>
                    Any detected secrets (API keys, tokens, passwords) will be replaced with{' '}
                    <code className="bg-surface-raised dark:bg-surface-dark-raised border border-border dark:border-border-dark px-1 rounded font-mono">&lt;SECRET&gt;</code>{' '}
                    placeholders. You&apos;ll need to re-enter these values after importing.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeEnvironment}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setIncludeEnvironment(e.target.checked)}
                  className="w-4 h-4 text-primary border-border dark:border-border-dark rounded focus:ring-primary cursor-pointer"
                />
                <span className="text-sm text-text-primary dark:text-text-primary-dark">
                  Include referenced environment (if any)
                </span>
              </label>
            </div>

            {error && (
              <div className="bg-[var(--aw-status-error)]/5 dark:bg-[var(--aw-status-error)]/10 border border-[var(--aw-status-error)]/20 dark:border-[var(--aw-status-error)]/30 rounded p-4 text-sm text-status-error dark:text-status-error-dark">
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
                    file:rounded file:border-0
                    file:text-sm file:font-medium
                    file:bg-[var(--aw-primary)]/5 file:text-[var(--aw-primary)]
                    hover:file:bg-[var(--aw-primary)]/10
                    dark:file:bg-[var(--aw-primary)]/10 dark:file:text-[var(--aw-primary)]
                    dark:hover:file:bg-[var(--aw-primary)]/20"
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
                className="w-full h-32"
              />
            </div>

            {/* Options */}
            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createMissingEnvs}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setCreateMissingEnvs(e.target.checked)}
                  className="w-4 h-4 text-primary border-border dark:border-border-dark rounded focus:ring-primary cursor-pointer"
                />
                <span className="text-sm text-text-primary dark:text-text-primary-dark">
                  Create missing environments from bundle
                </span>
              </label>
            </div>

            {/* Dry run result */}
            {dryRunResult && (
              <div className={`border rounded p-4 ${
                dryRunResult.valid
                  ? 'bg-[var(--aw-status-success)]/5 dark:bg-[var(--aw-status-success)]/10 border-[var(--aw-status-success)]/20 dark:border-[var(--aw-status-success)]/30'
                  : 'bg-[var(--aw-status-error)]/5 dark:bg-[var(--aw-status-error)]/10 border-[var(--aw-status-error)]/20 dark:border-[var(--aw-status-error)]/30'
              }`}>
                <div className="flex items-start gap-2">
                  {dryRunResult.valid ? (
                    <CheckCircle className="w-5 h-5 text-[var(--aw-status-success)] flex-shrink-0" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-[var(--aw-status-error)] flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
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
                          <p className="text-[var(--aw-status-warning)] flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
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
                      <ul className="mt-2 text-sm text-[var(--aw-status-warning)] list-disc list-inside">
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
              <div className="bg-[var(--aw-status-success)]/5 dark:bg-[var(--aw-status-success)]/10 border border-[var(--aw-status-success)]/20 dark:border-[var(--aw-status-success)]/30 rounded p-4">
                <div className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 text-[var(--aw-status-success)] flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-status-success dark:text-status-success-dark">
                      Import successful!
                    </p>
                    <p className="text-sm text-status-success dark:text-status-success-dark mt-1">
                      Workflow ID: {importResult.workflowId}
                    </p>
                    {importResult.secretReferences && importResult.secretReferences.length > 0 && (
                      <p className="text-sm text-[var(--aw-status-warning)] mt-2 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                        <span>Remember to re-enter {importResult.secretReferences.length} secret value(s)</span>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-[var(--aw-status-error)]/5 dark:bg-[var(--aw-status-error)]/10 border border-[var(--aw-status-error)]/20 dark:border-[var(--aw-status-error)]/30 rounded p-4 text-sm text-status-error dark:text-status-error-dark">
                {error}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3">
              <Button
                onClick={handleDryRun}
                disabled={!importJson}
                variant="outline"
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
    </Modal>
  );
}

export default WorkflowExportImport;
