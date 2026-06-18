import { useState, type ChangeEvent, type DragEvent } from 'react';
import { Upload, FileText, AlertCircle, X, List, GitBranch } from 'lucide-react';
import { usePalette } from '../contexts/PaletteContext';
import { Button } from './atoms/Button';
import { IconButton } from './atoms/IconButton';
import { Input } from './atoms/Input';
import { useScopeContext } from '../hooks/useScopeContext';
import { authenticatedFetch } from '../utils/authenticatedApi';
import { workflowImportHarUrl } from '../utils/scopedApi';

interface HARPreviewEntry {
  method: string;
  url: string;
  headers?: string;
  body?: string;
  time?: number;
}

interface HARImportDryRunStats {
  totalEntries?: number;
  nodes?: number;
  edges?: number;
}

interface HARImportDryRunResult {
  stats: HARImportDryRunStats;
  preview: HARPreviewEntry[];
}

interface HARImportProps {
  onClose: () => void;
  onImportSuccess?: (result: HARImportDryRunResult) => void;
}

type ImportMode = 'linear' | 'grouped';

function getMethodBadgeClasses(method: string): string {
  switch (method) {
    case 'GET':
      return 'bg-[var(--aw-status-info)]/10 dark:bg-[var(--aw-status-info)]/20 text-[var(--aw-status-info)] dark:text-[var(--aw-status-info)]';
    case 'POST':
      return 'bg-[var(--aw-status-success)]/10 dark:bg-[var(--aw-status-success)]/20 text-[var(--aw-status-success)] dark:text-[var(--aw-status-success)]';
    case 'PUT':
      return 'bg-[var(--aw-status-warning)]/10 dark:bg-[var(--aw-status-warning)]/20 text-[var(--aw-status-warning)] dark:text-[var(--aw-status-warning)]';
    case 'DELETE':
      return 'bg-[var(--aw-status-error)]/10 dark:bg-[var(--aw-status-error)]/20 text-[var(--aw-status-error)] dark:text-[var(--aw-status-error)]';
    default:
      return 'bg-surface dark:bg-surface-dark text-text-primary dark:text-text-primary-dark';
  }
}

export function HARImport({ onClose, onImportSuccess }: HARImportProps) {
  const { workspaceId } = useScopeContext();
  const [harFile, setHarFile] = useState<File | null>(null);
  const [harJson, setHarJson] = useState<Record<string, unknown> | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('linear');
  const [sanitize, setSanitize] = useState(true);
  const [dryRunResult, setDryRunResult] = useState<HARImportDryRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groupTitle, setGroupTitle] = useState('');
  const { addImportedGroup } = usePalette();

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setHarFile(file);
      setError(null);
      setDryRunResult(null);

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const json = JSON.parse(event.target?.result as string);
          setHarJson(json);
        } catch (err) {
          setError('Invalid HAR file: ' + (err as Error).message);
          setHarJson(null);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const file = e.dataTransfer.files[0];
    if (file) {
      const syntheticEvent = { target: { files: [file] } } as unknown as ChangeEvent<HTMLInputElement>;
      handleFileSelect(syntheticEvent);
    }
  };

  const handlePreview = async () => {
    if (!harFile) {
      setError('Please select a HAR file first');
      return;
    }

    setError(null);
    setDryRunResult(null);

    try {
      const formData = new FormData();
      formData.append('file', harFile);
      formData.append('import_mode', importMode);
      formData.append('sanitize', String(sanitize));

      const response = await authenticatedFetch(workflowImportHarUrl(workspaceId || '', true), {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json() as { detail?: string };
        throw new Error(errorData.detail || 'Preview failed');
      }

      const result = (await response.json()) as HARImportDryRunResult;
      setDryRunResult(result);
    } catch (err) {
      console.error('Preview error:', err);
      setError((err as Error).message);
    }
  };

  const handleImport = async () => {
    if (!harFile) {
      setError('Please select a HAR file first');
      return;
    }
    if (!dryRunResult || !Array.isArray(dryRunResult.preview)) {
      setError('Please run Preview first');
      return;
    }

    try {
      const items = dryRunResult.preview.map((entry) => ({
        label: `[${entry.method}] ${entry.url}`,
        method: entry.method || 'GET',
        url: entry.url || '',
        headers: entry.headers || '',
        cookies: '',
        queryParams: '',
        pathVariables: '',
        body: entry.body || '',
        timeout: 30,
      }));

      const itemCount = items.length;
      const finalTitle = groupTitle && groupTitle.trim()
        ? `${groupTitle.trim()} (${itemCount})`
        : `@${harFile.name.replace(/\.(har|json)$/i, '')} (${itemCount})`;

      addImportedGroup({
        id: `grp-${Date.now()}`,
        title: finalTitle,
        items,
      });

      onImportSuccess?.(dryRunResult);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <dialog open className="fixed inset-0 z-50 bg-transparent p-0" aria-label="HAR import">
      <button type="button" aria-label="Close HAR import" className="fixed inset-0 z-40 cursor-default bg-[var(--aw-surface)]/60 dark:bg-[var(--aw-surface)]/80" onClick={onClose} />
      <div className="relative z-50 bg-surface-raised dark:bg-surface-dark-raised rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border dark:border-border-dark">
          <h2 className="text-xl font-semibold text-text-primary dark:text-text-primary-dark">
            Import HAR File
          </h2>
          <IconButton onClick={onClose} tooltip="Close" size="sm">
            <X className="w-5 h-5" />
          </IconButton>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* Info */}
            <div>
              <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
                Import HTTP Archive (HAR) files to automatically create API test workflows from
                recorded browser sessions or API calls.
              </p>
            </div>

            {/* File Upload */}
            <div>
              <label htmlFor="har-file-input" className="block text-sm font-medium text-text-primary dark:text-text-primary-dark mb-2">
                HAR File
              </label>
              <div
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className="border-2 border-dashed border-border dark:border-border-dark rounded-lg p-8 text-center hover:border-primary dark:hover:border-primary transition-colors cursor-pointer"
              >
                <Upload className="w-12 h-12 text-text-muted dark:text-text-muted-dark mx-auto mb-4" />
                <p className="text-sm text-text-secondary dark:text-text-secondary-dark mb-2">
                  Drag and drop your HAR file here, or click to browse
                </p>
                <input
                  type="file"
                  accept=".har,.json"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="har-file-input"
                />
                <label
                  htmlFor="har-file-input"
                  className="inline-block bg-primary hover:bg-primary-hover text-white text-sm font-medium py-2 px-4 rounded cursor-pointer"
                >
                  Select File
                </label>
                {harFile && (
                  <p className="mt-3 text-sm text-status-success dark:text-status-success-dark">
                    ✓ {harFile.name}
                  </p>
                )}
              </div>
            </div>

            {/* Import Options */}
            {harJson && (
              <div className="space-y-4">
                <div>
                <div className="block text-sm font-medium text-text-primary dark:text-text-primary-dark mb-2">
                  Import Mode
                </div>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        value="linear"
                        checked={importMode === 'linear'}
                        onChange={(e) => setImportMode(e.target.value as ImportMode)}
                        aria-label="Linear import mode"
                        className="w-4 h-4 text-primary border-border focus:ring-primary"
                      />
                      <List className="w-4 h-4 text-text-muted dark:text-text-muted-dark" />
                      <span className="text-sm text-text-primary dark:text-text-primary-dark">
                        Linear (Sequential)
                      </span>
                    </label>
                    <label className="flex items-center gap-2 opacity-50 cursor-not-allowed">
                      <input
                        type="radio"
                        value="grouped"
                        checked={importMode === 'grouped'}
                        onChange={(e) => setImportMode(e.target.value as ImportMode)}
                        disabled
                        aria-label="Grouped import mode"
                        className="w-4 h-4 text-primary border-border focus:ring-primary"
                      />
                      <GitBranch className="w-4 h-4 text-text-muted dark:text-text-muted-dark" />
                      <span className="text-sm text-text-primary dark:text-text-primary-dark">
                        Grouped (Parallel) - Coming Soon
                      </span>
                    </label>
                  </div>
                </div>

                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={sanitize}
                    onChange={(e) => setSanitize(e.target.checked)}
                    className="w-4 h-4 text-primary border-border rounded focus:ring-primary"
                  />
                  <span className="text-sm text-text-primary dark:text-text-primary-dark">
                    Sanitize sensitive headers (Authorization, API keys, etc.)
                  </span>
                </label>
              </div>
            )}

            {/* Preview Result */}
            {dryRunResult && (
              <div className="border border-border dark:border-border-dark rounded-lg overflow-hidden">
                <div className="bg-surface dark:bg-surface-dark px-4 py-3 border-b border-border dark:border-border-dark">
                  <h3 className="text-sm font-medium text-text-primary dark:text-text-primary-dark">
                    Preview
                  </h3>
                </div>
                <div className="p-4 space-y-4">
                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-2xl font-bold text-[var(--aw-status-info)] dark:text-[var(--aw-status-info)]">
                        {dryRunResult.stats?.totalEntries || 0}
                      </p>
                      <p className="text-xs text-text-secondary dark:text-text-secondary-dark">Total Requests</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-status-success dark:text-status-success-dark">
                        {dryRunResult.stats?.nodes || 0}
                      </p>
                      <p className="text-xs text-text-secondary dark:text-text-secondary-dark">Nodes</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-[var(--aw-branch-edge)] dark:text-[var(--aw-branch-edge)]">
                        {dryRunResult.stats?.edges || 0}
                      </p>
                      <p className="text-xs text-text-secondary dark:text-text-secondary-dark">Edges</p>
                    </div>
                  </div>

                  {/* Entry Preview */}
                  {dryRunResult.preview && dryRunResult.preview.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-text-primary dark:text-text-primary-dark mb-2">
                        First {dryRunResult.preview.length} requests:
                      </p>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                          {dryRunResult.preview.map((entry) => (
                            <div
                              key={`${entry.method}-${entry.url}-${entry.time ?? ''}`}
                              className="flex items-center gap-3 text-xs bg-surface dark:bg-surface-dark p-2 rounded"
                            >
                            <span className={`font-medium px-2 py-0.5 rounded ${getMethodBadgeClasses(entry.method)}`}>
                              {entry.method}
                            </span>
                            <span className="flex-1 text-text-secondary dark:text-text-secondary-dark truncate">
                              {entry.url}
                            </span>
                            <span className="text-text-muted dark:text-text-muted-dark">
                              {entry.time}ms
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Group Title */}
            {harJson && (
              <div className="mt-2">
                <Input
                  value={groupTitle}
                  onChange={(e) => setGroupTitle(e.target.value)}
                  placeholder={harFile?.name || 'My HAR Group'}
                  label="Palette Group Title (optional)"
                  size="sm"
                />
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="bg-[var(--aw-status-error)]/5 dark:bg-[var(--aw-status-error)]/10 border border-[var(--aw-status-error)]/20 dark:border-[var(--aw-status-error)]/30 rounded-lg p-4">
                <div className="flex items-start">
                  <AlertCircle className="w-5 h-5 text-status-error dark:text-status-error-dark mr-2" />
                  <p className="text-sm text-[var(--aw-status-error)] dark:text-[var(--aw-status-error)]">{error}</p>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4 border-t border-border dark:border-border-dark">
              <Button
                onClick={handlePreview}
                disabled={!harJson}
                variant="secondary"
                icon={<FileText className="w-4 h-4" />}
                fullWidth
              >
                Preview
              </Button>
              <Button
                onClick={handleImport}
                disabled={!harJson}
                variant="primary"
                intent="info"
                icon={<Upload className="w-4 h-4" />}
                fullWidth
              >
                Add to Nodes
              </Button>
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
}

export default HARImport;
