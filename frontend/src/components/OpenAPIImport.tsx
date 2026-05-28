import { useState, type ChangeEvent, type DragEvent } from 'react';
import { FileText, X, Upload, CheckCircle, AlertCircle } from 'lucide-react';
import { usePalette } from '../contexts/PaletteContext';
import { Button } from './atoms/Button';
import { IconButton } from './atoms/IconButton';
import { Input } from './atoms/Input';

interface OpenAPIImportProps {
  onClose: () => void;
  onImportSuccess?: () => void;
}

interface PreviewNode {
  type?: string;
  label?: string;
  config?: {
    method?: string;
    url?: string;
    headers?: string;
    cookies?: string;
    queryParams?: string;
    pathVariables?: string;
    body?: string;
    timeout?: number;
  };
}

interface PreviewStats {
  apiTitle?: string;
  apiVersion?: string;
  totalEndpoints?: number;
}

interface PreviewWorkflow {
  nodeCount?: number;
}

interface PreviewServer {
  url: string;
  description?: string;
}

interface PreviewTag {
  name: string;
  description?: string;
}

interface PreviewData {
  nodes?: PreviewNode[];
  stats?: PreviewStats;
  workflow?: PreviewWorkflow;
  availableServers?: PreviewServer[];
  availableTags?: PreviewTag[];
}

interface ImportedItem {
  label: string | undefined;
  method: string;
  url: string;
  headers: string;
  cookies: string;
  queryParams: string;
  pathVariables: string;
  body: string;
  timeout: number;
}

export function OpenAPIImport({ onClose, onImportSuccess }: OpenAPIImportProps) {
  const [openapiFile, setOpenapiFile] = useState<File | null>(null);
  const [openapiJson, setOpenapiJson] = useState<Record<string, unknown> | null>(null);
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sanitize, setSanitize] = useState<boolean>(true);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [groupTitle, setGroupTitle] = useState<string>('');
  const { addImportedGroup } = usePalette();

  const handleFileUpload = (file: File | undefined) => {
    if (!file) return;
    
    if (!file.name.endsWith('.json')) {
      setError('Please upload a JSON file (.json)');
      return;
    }

    setError(null);
    setOpenapiFile(file);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string) as Record<string, unknown>;
        setOpenapiJson(parsed);
        
        if (!baseUrl && parsed.servers && Array.isArray(parsed.servers) && parsed.servers.length > 0) {
          const firstServer = parsed.servers[0] as Record<string, unknown>;
          if (typeof firstServer.url === 'string') {
            setBaseUrl(firstServer.url);
          }
        }
      } catch {
        setError('Invalid JSON format');
      }
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
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
      params.append('sanitize', String(sanitize));

      const response = await fetch(`/api/workflows/import/openapi/dry-run?${params}`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json() as Record<string, unknown>;
        throw new Error((errorData.detail as string) || 'Failed to preview OpenAPI file');
      }

      const data = await response.json() as PreviewData;
      setPreview(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unknown error occurred';
      setError(message);
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
      const items: ImportedItem[] = (preview.nodes || [])
        .filter((n): n is PreviewNode => n.type === 'http-request')
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

      const itemCount = items.length;
      let finalTitle = groupTitle && groupTitle.trim() 
        ? `${groupTitle.trim()} (${itemCount})`
        : `@${openapiFile.name.replace(/\.(json|yaml|yml)$/i, '')} (${itemCount})`;

      addImportedGroup({
        id: `grp-${Date.now()}`,
        title: finalTitle,
        items,
      });

      onClose();
      onImportSuccess?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unknown error occurred';
      setError(message);
    }
  };

  const handleServerSelect = (serverUrl: string) => {
    setBaseUrl(serverUrl);
  };

  const handleTagToggle = (tagName: string) => {
    setSelectedTags(prev => {
      if (prev.includes(tagName)) {
        return prev.filter(t => t !== tagName);
      }
      return [...prev, tagName];
    });
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    handleFileUpload(file);
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
              Import OpenAPI/Swagger
            </h2>
          </div>
          <IconButton
            onClick={onClose}
            variant="ghost"
            size="sm"
            className="text-text-muted dark:text-text-muted-dark hover:text-text-secondary dark:hover:text-text-secondary-dark"
          >
            <X className="w-5 h-5" />
          </IconButton>
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
                ? 'border-primary/50 bg-primary/5 dark:bg-primary/10'
                : 'border-border dark:border-border-dark'
            }`}
          >
            <Upload className="w-12 h-12 mx-auto mb-4 text-text-muted dark:text-text-muted-dark" />
            <p className="text-sm text-text-secondary dark:text-text-secondary-dark mb-2">
              Drag & drop your OpenAPI/Swagger JSON file here, or click to browse
            </p>
            <input
              type="file"
              accept=".json"
              onChange={handleFileInputChange}
              className="hidden"
              id="openapi-file-input"
            />
            <label
              htmlFor="openapi-file-input"
              className="inline-block px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover cursor-pointer"
            >
              Choose File
            </label>
            {openapiFile && (
              <p className="mt-2 text-sm text-status-success dark:text-status-success-dark flex items-center gap-1 justify-center">
                <CheckCircle className="w-4 h-4" />
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
                  <label htmlFor="openapi-base-url" className="block text-sm font-medium text-text-primary dark:text-text-primary-dark mb-2">
                    Base URL (Server)
                  </label>
                  <select
                    id="openapi-base-url"
                    value={baseUrl}
                    onChange={(e) => handleServerSelect(e.target.value)}
                    className="w-full px-3 py-2 border border-border dark:border-border-dark rounded-lg bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark"
                  >
                    <option value="">-- Select Server --</option>
                    {preview.availableServers.map((server) => (
                      <option key={server.url} value={server.url}>
                        {server.url} {server.description && `(${server.description})`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Custom Base URL */}
              <div>
                <label htmlFor="openapi-custom-base-url" className="block text-sm font-medium text-text-primary dark:text-text-primary-dark mb-2">
                  Custom Base URL (optional)
                </label>
                <Input
                  id="openapi-custom-base-url"
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com"
                />
              </div>

              {/* Tag Filter */}
              {preview?.availableTags && preview.availableTags.length > 0 && (
                <div>
                  <div className="block text-sm font-medium text-text-primary dark:text-text-primary-dark mb-2">
                    Filter by Tags (select to import only specific tags)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {preview.availableTags.map((tag) => (
                      <Button
                        key={tag.name}
                        onClick={() => handleTagToggle(tag.name)}
                        variant={selectedTags.includes(tag.name) ? 'primary' : 'secondary'}
                        size="xs"
                        className="rounded-full"
                        title={tag.description}
                      >
                        {tag.name}
                      </Button>
                    ))}
                  </div>
                  {selectedTags.length === 0 && (
                    <p className="text-xs text-text-muted dark:text-text-muted-dark mt-1">
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
                <label htmlFor="sanitize-openapi" className="text-sm text-text-primary dark:text-text-primary-dark">
                  Sanitize sensitive headers (Authorization, API keys)
                </label>
              </div>

              {/* Group Title */}
              <div>
                <label htmlFor="openapi-palette-group-title" className="block text-sm font-medium text-text-primary dark:text-text-primary-dark mb-2">
                  Palette Group Title (optional)
                </label>
                <Input
                  id="openapi-palette-group-title"
                  type="text"
                  value={groupTitle}
                  onChange={(e) => setGroupTitle(e.target.value)}
                  placeholder={openapiFile?.name || 'My API Group'}
                />
              </div>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <AlertCircle className="w-5 h-5 text-status-error dark:text-status-error-dark flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          {/* Preview Display */}
          {preview && (
            <div className="border border-border dark:border-border-dark rounded-lg p-4 bg-surface dark:bg-surface-dark">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle className="w-5 h-5 text-status-success dark:text-status-success-dark" />
                <h3 className="font-semibold text-text-primary dark:text-text-primary-dark">Preview</h3>
              </div>
              
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-text-secondary dark:text-text-secondary-dark">API:</span>
                  <span className="font-medium text-text-primary dark:text-text-primary-dark">
                    {preview.stats?.apiTitle} (v{preview.stats?.apiVersion})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary dark:text-text-secondary-dark">Endpoints:</span>
                  <span className="font-medium text-text-primary dark:text-text-primary-dark">
                    {preview.stats?.totalEndpoints}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary dark:text-text-secondary-dark">Total Nodes:</span>
                  <span className="font-medium text-text-primary dark:text-text-primary-dark">
                    {preview.workflow?.nodeCount}
                  </span>
                </div>
                {selectedTags.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-text-secondary dark:text-text-secondary-dark">Selected Tags:</span>
                    <span className="font-medium text-text-primary dark:text-text-primary-dark">
                      {selectedTags.join(', ')}
                    </span>
                  </div>
                )}
              </div>

              {/* Node Preview */}
              {preview.nodes && preview.nodes.length > 2 && (
                <div className="mt-4">
                  <h4 className="text-xs font-semibold text-text-primary dark:text-text-primary-dark mb-2">
                    Sample Endpoints (first 5):
                  </h4>
                  <div className="space-y-1">
                    {preview.nodes.slice(1, 6).map((node) => (
                      <div
                        key={node.label ?? node.config?.method ?? node.type ?? 'endpoint'}
                        className="text-xs px-2 py-1 bg-surface-raised dark:bg-surface-dark-raised rounded border border-border dark:border-border-dark"
                      >
                        <span className="font-mono text-primary dark:text-primary-dark">
                          {node.config?.method}
                        </span>{' '}
                        <span className="text-text-primary dark:text-text-primary-dark">{node.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="border-t border-border dark:border-border-dark p-4 flex justify-between">
          <Button
            onClick={onClose}
            variant="ghost"
            disabled={isLoading}
          >
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button
              onClick={handlePreview}
              variant="secondary"
              disabled={!openapiFile || isLoading}
              loading={isLoading}
            >
              {isLoading ? 'Loading...' : 'Preview'}
            </Button>
            <Button
              onClick={handleImport}
              variant="primary"
              disabled={!preview || isLoading}
              loading={isLoading}
            >
              {isLoading ? 'Adding...' : 'Add to Nodes'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default OpenAPIImport;
