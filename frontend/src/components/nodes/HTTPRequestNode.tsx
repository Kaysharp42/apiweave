import { memo, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useReactFlow } from 'reactflow';
import { useWorkflow } from '../../contexts/WorkflowContext';
import { BaseNode } from '../atoms/flow/BaseNode';
import FileUploadSection from '../FileUploadSection';
import type { FileUpload } from '../../types/FileUpload';
import {
  Puzzle,
  Plus,
  Trash2,
  CheckCircle,
  ArrowRight,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Snowflake,
  ExternalLink,
  Clock3,
  Globe,
} from 'lucide-react';
import { BeautifyButton } from '../molecules/BeautifyButton';
import { StatusBadge } from '../molecules/StatusBadge';
import type { NodeStatus } from '../../types/NodeStatus';
import type { HttpMethod } from '../../types/HttpMethod';
import type { HTTPRequestNodeData, HTTPRequestNodeProps, SchemaWarning } from '../../types/HTTPRequestNodeProps';

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

const methodBadgeClasses: Record<HttpMethod, string> = {
  GET: 'text-method-get bg-method-get/10 border-method-get/30',
  POST: 'text-method-post bg-method-post/10 border-method-post/30',
  PUT: 'text-method-put bg-method-put/10 border-method-put/30',
  DELETE: 'text-method-delete bg-method-delete/10 border-method-delete/30',
  PATCH: 'text-method-patch bg-method-patch/10 border-method-patch/30',
  HEAD: 'text-method-head bg-method-head/10 border-method-head/30',
  OPTIONS: 'text-method-options bg-method-options/10 border-method-options/30',
};

const formatRefreshTime = (isoValue: string | undefined): string => {
  if (!isoValue) return 'Unavailable';
  const parsedDate = new Date(isoValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return isoValue;
  }
  return parsedDate.toLocaleString();
};

const formatResponseDuration = (milliseconds: number): string => (
  milliseconds >= 1000 ? `${(milliseconds / 1000).toFixed(2)}s` : `${milliseconds}ms`
);

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`;
  return `${(kilobytes / 1024).toFixed(1)} MB`;
};

const getBodyPreview = (body: string | undefined): string => {
  const normalizedBody = body?.trim().replace(/\s+/g, ' ') ?? '';
  if (!normalizedBody) return '';
  return normalizedBody.length > 50 ? `${normalizedBody.slice(0, 50)}...` : normalizedBody;
};

interface SchemaWarningBadgeProps {
  warning: SchemaWarning;
}

const SchemaWarningBadge = ({ warning }: SchemaWarningBadgeProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside, { passive: true });
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleWarningPopoverBlur = useCallback((event: React.FocusEvent) => {
    const nextFocusedElement = event.relatedTarget;
    if (!nextFocusedElement) return;
    if (wrapperRef.current && !wrapperRef.current.contains(nextFocusedElement as Node)) {
      setIsOpen(false);
    }
  }, []);

  const refreshedLabel = useMemo(() => formatRefreshTime(warning?.refreshedAt), [warning?.refreshedAt]);

  if (!warning) return null;

  return (
    <div
      ref={wrapperRef}
      className="relative flex-shrink-0"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      onFocus={() => setIsOpen(true)}
      onBlur={handleWarningPopoverBlur}
    >
      <button
        ref={triggerRef}
        type="button"
        className="nodrag text-[9px] px-1.5 py-0.5 rounded-sm font-mono border border-status-warning/30 bg-status-warning/10 text-status-warning flex items-center gap-0.5 cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
        title={warning.text ?? 'Swagger docs changed. Verify this request.'}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label="Show Swagger warning details"
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen((previousState) => !previousState);
        }}
      >
        <AlertTriangle className="w-3 h-3" />
        Check API
      </button>

      {isOpen && (
        <dialog
          open
          aria-label="Swagger warning details"
          className="nodrag absolute top-full right-0 mt-1 z-[120] w-[260px] max-w-[calc(100vw-2rem)] rounded-sm border p-2 shadow-node bg-surface-raised dark:bg-surface-dark-raised"
          style={{
            borderColor: 'var(--aw-status-warning)',
          }}
        >
          <div className="text-[10px] font-semibold mb-1" style={{ color: 'var(--aw-status-warning)' }}>
            Swagger Warning
          </div>
          <p className="text-[10px] leading-snug break-words" style={{ color: 'var(--aw-text-primary)' }}>
            {warning.text}
          </p>

          <div className="mt-2 pt-2 border-t space-y-1 text-[9px]" style={{ borderColor: 'var(--aw-border)', color: 'var(--aw-text-secondary)' }}>
            <div className="flex items-center gap-1">
              <Clock3 className="w-3 h-3" />
              <span className="font-semibold">Refreshed:</span>
            </div>
            <div style={{ color: 'var(--aw-text-primary)' }} className="pl-4">{refreshedLabel}</div>

            <div className="flex items-center gap-1 pt-1">
              <ExternalLink className="w-3 h-3" />
              <span className="font-semibold">Source:</span>
            </div>

            {warning.sourceUrl ? (
              <a
                href={warning.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="pl-4 block underline hover:opacity-80 break-all cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                style={{ color: 'var(--aw-primary)' }}
                title={warning.sourceUrl}
              >
                {warning.sourceUrl}
              </a>
            ) : (
              <div className="pl-4" style={{ color: 'var(--aw-text-muted)' }}>Unavailable</div>
            )}
          </div>
        </dialog>
      )}
    </div>
  );
};

interface ExtractorFormProps {
  onAdd: (varName: string, varPath: string) => void;
}

const ExtractorForm = ({ onAdd }: ExtractorFormProps) => {
  const [varName, setVarName] = useState('');
  const [varPath, setVarPath] = useState('response.body.');

  const handleAdd = () => {
    if (varName.trim() && varPath.trim()) {
      onAdd(varName.trim(), varPath.trim());
      setVarName('');
      setVarPath('response.body.');
    }
  };

  return (
    <div className="space-y-1 p-1.5 rounded-sm border border-dashed bg-surface-overlay dark:bg-surface-dark-overlay border-border dark:border-border-dark">
      <input
        type="text"
        placeholder="Variable name (e.g., token)"
        aria-label="Extractor variable name"
        className="nodrag w-full px-1.5 py-0.5 border rounded-sm text-[9px] bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border-border dark:border-border-dark focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
        value={varName}
        onChange={(e) => setVarName(e.target.value)}
      />
      <input
        type="text"
        placeholder="Path (e.g., response.body.token)"
        aria-label="Extractor path"
        className="nodrag w-full px-1.5 py-0.5 border rounded-sm text-[9px] font-mono bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border-border dark:border-border-dark focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
        value={varPath}
        onChange={(e) => setVarPath(e.target.value)}
      />
      <button
        type="button"
        onClick={handleAdd}
        aria-label="Add extractor"
        className="w-full px-2 py-1 text-surface-raised dark:text-surface-dark-raised text-[9px] font-semibold rounded-sm nodrag transition-colors flex items-center justify-center gap-1 cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] motion-reduce:transition-none bg-primary dark:bg-primary-light"
      >
        <Plus className="w-3 h-3" />
        <span>Add Extractor</span>
      </button>
    </div>
  );
};

interface ResponsePreviewProps {
  result: HTTPRequestNodeData['executionResult'];
  status: NodeStatus | undefined;
}

const ResponsePreview = ({ result, status }: ResponsePreviewProps) => {
  const [isBodyExpanded, setIsBodyExpanded] = useState(false);
  const [isBodyBeautified, setIsBodyBeautified] = useState(true);

  const bodyStr = useMemo(() => {
    if (!result?.body) return '';
    const raw = typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2);
    if (!isBodyBeautified) {
      try {
        return JSON.stringify(JSON.parse(raw));
      } catch {
        return raw;
      }
    }
    return raw;
  }, [result?.body, isBodyBeautified]);

  const handleToggleBodyFormat = useCallback(() => {
    setIsBodyBeautified((prev) => !prev);
  }, []);

  if (!result) return null;

  const codeClass = (() => {
    const c = result.statusCode;
    if (!c) return '';
    if (c >= 200 && c < 300) return 'bg-[var(--aw-status-success)]/10 text-[var(--aw-status-success)]';
    if (c >= 300 && c < 400) return 'bg-[var(--aw-status-info)]/10 text-[var(--aw-status-info)]';
    if (c >= 400 && c < 500) return 'bg-[var(--aw-status-warning)]/10 text-[var(--aw-status-warning)]';
    return 'bg-[var(--aw-status-error)]/10 text-[var(--aw-status-error)]';
  })();

  const statusLabel = (() => {
    const c = result.statusCode;
    if (!c) return null;
    if (c >= 200 && c < 300) return <><CheckCircle className="w-3 h-3" /> Success</>;
    if (c >= 300 && c < 400) return <><ArrowRight className="w-3 h-3" /> Redirect</>;
    if (c >= 400 && c < 500) return <><AlertTriangle className="w-3 h-3" /> Client Error</>;
    return <><XCircle className="w-3 h-3" /> Server Error</>;
  })();

  const responseTime = result.responseTimeMs ?? result.duration;
  const responseMetadata = [
    responseTime !== undefined && !result.statusCode ? formatResponseDuration(responseTime) : undefined,
    result.responseSizeBytes !== undefined ? formatBytes(result.responseSizeBytes) : undefined,
    result.contentType,
    result.bodyFormat ? `body: ${result.bodyFormat}` : undefined,
  ].filter((metadata): metadata is string => Boolean(metadata));

  return (
    <div className="mt-2 pt-2 border-t border-border dark:border-border-dark">
      <div className="text-[10px] font-semibold mb-1" style={{ color: 'var(--aw-text-secondary)' }}>
        Response
      </div>

      {result.statusCode && (
        <div className="flex items-center gap-2 flex-wrap text-[10px]">
          <span className={`font-mono px-1.5 py-0.5 rounded-sm ${codeClass}`}>{result.statusCode}</span>
          <span className="flex items-center gap-1" style={{ color: 'var(--aw-text-secondary)' }}>{statusLabel}</span>
          {responseTime !== undefined && (
            <>
              <span style={{ color: 'var(--aw-text-muted)' }}>&bull;</span>
              <span className="font-mono px-1.5 py-0.5 rounded-sm bg-[var(--aw-status-info)]/10 text-[var(--aw-status-info)]">
                {formatResponseDuration(responseTime)}
              </span>
            </>
          )}
        </div>
      )}

      {responseMetadata.length > 0 && (
        <div className="mt-1 flex items-center gap-1 flex-wrap text-[9px]" style={{ color: 'var(--aw-text-secondary)' }}>
          {responseMetadata.map((metadata) => (
            <span key={metadata} className="px-1.5 py-0.5 rounded-sm bg-surface-overlay dark:bg-surface-dark-overlay">
              {metadata}
            </span>
          ))}
        </div>
      )}

      {result.cookies && Object.keys(result.cookies).length > 0 && (
        <div className="mt-1 text-[10px]" style={{ color: 'var(--aw-text-secondary)' }}>
          <span className="font-semibold">Cookies:</span>
          <div className="pl-2 text-[9px] space-y-0.5 mt-0.5">
            {Object.entries(result.cookies).map(([key, value]) => (
              <div key={key}>
                <code className="px-1 rounded-sm bg-surface-overlay dark:bg-surface-dark-overlay">{key}</code>: {value}
              </div>
            ))}
          </div>
        </div>
      )}

      {result.body && (
        <div className={`mt-1 rounded-sm ${status === 'error' ? 'border border-status-error bg-[var(--aw-status-error)]/5' : ''}`}>
          <div className={`text-[10px] font-semibold mb-0.5 flex items-center justify-between ${status === 'error' ? '' : ''}`} style={{ color: status === 'error' ? 'var(--aw-status-error)' : 'var(--aw-text-secondary)' }}>
            <span>Body{status === 'error' ? ' (Error)' : ''}</span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={handleToggleBodyFormat}
                aria-label={isBodyBeautified ? 'Minify JSON' : 'Beautify JSON'}
                className="p-0.5 rounded transition-colors nodrag cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] motion-reduce:transition-none"
                style={{ backgroundColor: 'transparent' }}
                title={isBodyBeautified ? 'Minify JSON' : 'Beautify JSON'}
              >
                <Puzzle className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => setIsBodyExpanded(!isBodyExpanded)}
                aria-label={isBodyExpanded ? 'Collapse response body' : 'Expand response body'}
                className="p-0.5 rounded transition-colors nodrag cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] motion-reduce:transition-none"
                style={{ backgroundColor: 'transparent' }}
                title={isBodyExpanded ? 'Collapse' : 'Expand'}
              >
                {isBodyExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            </div>
          </div>
            <textarea
            className={`w-full px-1.5 py-1 border text-[10px] font-mono nodrag rounded-sm overflow-y-auto focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] ${status === 'error' ? 'bg-[var(--aw-status-error)]/5' : 'bg-surface-raised dark:bg-surface-dark-raised'}`}
            style={{
              height: isBodyExpanded ? '600px' : '150px',
              resize: 'vertical',
              minHeight: '100px',
              borderColor: status === 'error' ? 'var(--aw-status-error)' : 'var(--aw-border)',
              color: status === 'error' ? 'var(--aw-status-error)' : 'var(--aw-text-primary)',
            }}
            aria-label="Response body"
            value={bodyStr}
            readOnly
            onFocus={(e) => e.target.select()}
          />
        </div>
      )}

      {result.error && (
        <div className="text-[10px] mt-1 p-1.5 rounded-sm bg-[var(--aw-status-error)]/5 text-status-error dark:text-status-error-dark">
          <span className="font-semibold">Error:</span> {result.error}
        </div>
      )}
    </div>
  );
};

const HTTPRequestNode = ({ id, data, selected }: HTTPRequestNodeProps) => {
  const { setNodes } = useReactFlow();
  const { variables } = useWorkflow();

  const updateNodeData = useCallback((field: string, value: unknown) => {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, config: { ...node.data.config, [field]: value } } }
          : node
      )
    );
  }, [id, setNodes]);

  const method = (data.config?.method ?? 'GET') as HttpMethod;
  const methodBadgeClass = methodBadgeClasses[method] ?? methodBadgeClasses.GET;

  const headerCount = (data.config?.headers ?? '').split('\n').filter(Boolean).length;
  const extractorCount = data.config?.extractors ? Object.keys(data.config.extractors).length : 0;
  const hasBody = data.config?.body && data.config?.method !== 'GET';
  const bodyFormat = data.config?.bodyType ?? 'raw';
  const bodyPreview = getBodyPreview(data.config?.body);

  const icon = useMemo(() => (
    <span className="mr-2 inline-flex items-center gap-1">
      <span
        className={`inline-flex items-center justify-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono border rounded-sm leading-none ${methodBadgeClass}`}
        title={`HTTP ${method}`}
      >
        <Globe className="w-2.5 h-2.5" aria-hidden="true" />
        {method}
      </span>
      {hasBody && (
        <StatusBadge
          status="info"
          size="xs"
          label={`body: ${bodyFormat}`}
          className="nodrag whitespace-nowrap"
        />
      )}
    </span>
  ), [bodyFormat, hasBody, method, methodBadgeClass]);

  const titleExtra = useMemo(() => (
    <>
      {data.schemaRefreshWarning && (
        <SchemaWarningBadge warning={data.schemaRefreshWarning} />
      )}
      {data.branchCount && data.branchCount > 1 && (
        <span
          className="text-[9px] px-1.5 py-0.5 rounded-sm font-mono border border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay text-text-secondary dark:text-text-secondary-dark flex items-center gap-0.5"
          title={`${data.branchCount} parallel branches`}
        >
          <Snowflake className="w-3 h-3" /> {data.branchCount}x
        </span>
      )}
    </>
  ), [data.branchCount, data.schemaRefreshWarning]);

  return (
    <BaseNode
      title={data.label ?? 'HTTP Request'}
      icon={icon}
      status={data.executionStatus ?? 'idle'}
      statusBadgeText={data.executionStatus && data.executionStatus !== 'idle' ? data.executionStatus : ''}
      selected={selected ?? false}
      nodeId={id}
      handleLeft={{ type: 'target' }}
      handleRight={{ type: 'source' }}
      collapsible={true}
      defaultExpanded={false}
      titleExtra={titleExtra}
      className="max-w-[320px]"
    >
      {({ isExpanded }) => (
        <div className="p-3 space-y-1.5">
          <div className={`flex gap-1 ${isExpanded ? 'items-start' : 'items-center'}`}>
            <select
              aria-label="HTTP method"
                className={`nodrag px-2 py-1 border rounded-sm text-[10px] font-mono focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] cursor-pointer ${methodBadgeClass}`}
              value={method}
              onChange={(e) => updateNodeData('method', e.target.value)}
            >
              {HTTP_METHODS.map((httpMethod) => (
                <option key={httpMethod} value={httpMethod}>{httpMethod === 'DELETE' ? 'DEL' : httpMethod}</option>
              ))}
            </select>

            {isExpanded ? (
              <textarea
                aria-label="Request URL"
                placeholder="Enter URL..."
                rows={2}
                className="nodrag flex-1 px-2 py-1 border rounded-sm text-xs font-mono focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] resize-y min-h-[58px]"
                style={{ borderColor: 'var(--aw-border)', backgroundColor: 'var(--aw-surface-raised)', color: 'var(--aw-text-primary)' }}
                value={data.config?.url ?? ''}
                onChange={(e) => updateNodeData('url', e.target.value)}
              />
            ) : (
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  aria-label="Request URL"
                  placeholder="Enter URL..."
                  className="nodrag w-full px-2 py-1 border rounded-sm text-xs font-mono focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] truncate"
                  style={{ borderColor: 'var(--aw-border)', backgroundColor: 'var(--aw-surface-raised)', color: 'var(--aw-text-primary)' }}
                  value={data.config?.url ?? ''}
                  onChange={(e) => updateNodeData('url', e.target.value)}
                />
              </div>
            )}
          </div>

          {!isExpanded && (
            <div className="flex gap-1.5 text-[9px] flex-wrap text-text-muted dark:text-text-muted-dark">
              {data.config?.url && (
                <span className="px-1.5 py-0.5 rounded-sm truncate max-w-full font-mono bg-surface-overlay dark:bg-surface-dark-overlay" title={data.config.url}>
                  {data.config.url}
                </span>
              )}
              {headerCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-sm bg-surface-overlay dark:bg-surface-dark-overlay">
                  {headerCount} header{headerCount > 1 ? 's' : ''}
                </span>
              )}
              {extractorCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-sm bg-[var(--aw-status-success)]/10 text-status-success dark:text-status-success-dark">
                  {extractorCount} extractor{extractorCount > 1 ? 's' : ''}
                </span>
              )}
              {hasBody && bodyPreview && (
                <span className="px-1.5 py-0.5 rounded-sm font-mono truncate max-w-full bg-surface-overlay dark:bg-surface-dark-overlay" title={data.config?.body}>
                  {bodyPreview}
                </span>
              )}
            </div>
          )}

          {isExpanded && (
            <div className="space-y-1.5 pt-1 border-t" style={{ borderColor: 'var(--aw-border)' }}>
              <div>
                <label htmlFor="http-request-query-params" className="block text-[10px] font-semibold mb-0.5" style={{ color: 'var(--aw-text-secondary)' }}>
                  Query Params <span className="font-normal" style={{ color: 'var(--aw-text-muted)' }}>(key=value)</span>
                </label>
                <textarea
                  id="http-request-query-params"
                  aria-label="Query parameters"
                  className="nodrag w-full px-1.5 py-1 border rounded text-[10px] font-mono focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                  style={{ borderColor: 'var(--aw-border)', backgroundColor: 'var(--aw-surface-raised)', color: 'var(--aw-text-primary)' }}
                  rows={2}
                  placeholder={'page=1\nlimit=10'}
                  value={data.config?.queryParams ?? ''}
                  onChange={(e) => updateNodeData('queryParams', e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="http-request-path-variables" className="block text-[10px] font-semibold mb-0.5" style={{ color: 'var(--aw-text-secondary)' }}>
                  Path Variables <span className="font-normal" style={{ color: 'var(--aw-text-muted)' }}>(Use :varName in URL)</span>
                </label>
                <textarea
                  id="http-request-path-variables"
                  aria-label="Path variables"
                  className="nodrag w-full px-1.5 py-1 border rounded text-[10px] font-mono focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                  style={{ borderColor: 'var(--aw-border)', backgroundColor: 'var(--aw-surface-raised)', color: 'var(--aw-text-primary)' }}
                  rows={2}
                  placeholder={'userId={{prev.response.body.id}}'}
                  value={data.config?.pathVariables ?? ''}
                  onChange={(e) => updateNodeData('pathVariables', e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="http-request-headers" className="block text-[10px] font-semibold mb-0.5" style={{ color: 'var(--aw-text-secondary)' }}>
                  Headers <span className="font-normal" style={{ color: 'var(--aw-text-muted)' }}>(key=value)</span>
                </label>
                <textarea
                  id="http-request-headers"
                  aria-label="Headers"
                  className="nodrag w-full px-1.5 py-1 border rounded text-[10px] font-mono focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                  style={{ borderColor: 'var(--aw-border)', backgroundColor: 'var(--aw-surface-raised)', color: 'var(--aw-text-primary)' }}
                  rows={2}
                  placeholder={'Content-Type=application/json\nAuthorization=Bearer {{variables.token}}'}
                  value={data.config?.headers ?? ''}
                  onChange={(e) => updateNodeData('headers', e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="http-request-cookies" className="block text-[10px] font-semibold mb-0.5" style={{ color: 'var(--aw-text-secondary)' }}>
                  Cookies <span className="font-normal" style={{ color: 'var(--aw-text-muted)' }}>(key=value)</span>
                </label>
                <textarea
                  id="http-request-cookies"
                  aria-label="Cookies"
                  className="nodrag w-full px-1.5 py-1 border rounded text-[10px] font-mono focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                  style={{ borderColor: 'var(--aw-border)', backgroundColor: 'var(--aw-surface-raised)', color: 'var(--aw-text-primary)' }}
                  rows={2}
                  placeholder={'session={{prev.response.cookies.session}}'}
                  value={data.config?.cookies ?? ''}
                  onChange={(e) => updateNodeData('cookies', e.target.value)}
                />
              </div>

              {method !== 'GET' && (
                <div>
                  <label htmlFor="http-request-body" className="block text-[10px] font-semibold mb-0.5" style={{ color: 'var(--aw-text-secondary)' }}>
                    Body
                  </label>
                  <div className="relative">
                    <textarea
                      id="http-request-body"
                      aria-label="Request body"
                      className="nodrag w-full px-1.5 py-1 border rounded text-[10px] font-mono focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                      style={{ borderColor: 'var(--aw-border)', backgroundColor: 'var(--aw-surface-raised)', color: 'var(--aw-text-primary)' }}
                      rows={3}
                      placeholder={'{\n  "key": "value"\n}'}
                      value={data.config?.body ?? ''}
                      onChange={(e) => updateNodeData('body', e.target.value)}
                    />
                    <div className="absolute top-1 right-1">
                      <BeautifyButton
                        value={data.config?.body ?? ''}
                        onChange={(val) => updateNodeData('body', val)}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="http-request-timeout" className="block text-[10px] font-semibold mb-0.5" style={{ color: 'var(--aw-text-secondary)' }}>
                  Timeout (seconds)
                </label>
                <input
                  id="http-request-timeout"
                  type="number"
                  aria-label="Timeout in seconds"
                  className="nodrag w-16 px-1.5 py-0.5 border rounded text-xs focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                  style={{ borderColor: 'var(--aw-border)', backgroundColor: 'var(--aw-surface-raised)', color: 'var(--aw-text-primary)' }}
                  value={data.config?.timeout ?? 30}
                  onChange={(e) => updateNodeData('timeout', parseInt(e.target.value))}
                  min="1"
                />
              </div>

              <div className="border-t pt-2 mt-2" style={{ borderColor: 'var(--aw-border)' }}>
                <div className="block text-[10px] font-semibold mb-1 flex items-center gap-1" style={{ color: 'var(--aw-text-secondary)' }}>
                  <Puzzle className="w-3.5 h-3.5" />
                  <span>Store Response As Variables</span>
                </div>
                <div className="space-y-1 mb-2">
                  {data.config?.extractors && Object.entries(data.config.extractors).length > 0 ? (
                    Object.entries(data.config.extractors).map(([varName, varPath]) => (
                      <div key={varName} className="flex gap-1 items-center text-[9px]">
                        <code className="px-1.5 py-0.5 rounded-sm flex-1 truncate bg-[var(--aw-status-success)]/10 text-status-success dark:text-status-success-dark">{varName}</code>
                        <span style={{ color: 'var(--aw-text-muted)' }}>&larr;</span>
                        <code className="px-1.5 py-0.5 rounded-sm flex-1 truncate bg-[var(--aw-status-info)]/10 text-status-info dark:text-status-info-dark">{varPath}</code>
                        <button
                          type="button"
                          className="nodrag flex-shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                          style={{ color: 'var(--aw-status-error)' }}
                          onClick={() => {
                            const newExtractors = { ...data.config?.extractors };
                            delete newExtractors[varName];
                            updateNodeData('extractors', newExtractors);
                          }}
                          title="Delete extractor"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="text-[9px] italic" style={{ color: 'var(--aw-text-muted)' }}>No extractors configured</div>
                  )}
                </div>
                <ExtractorForm onAdd={(varName, varPath) => {
                  const newExtractors = data.config?.extractors ?? {};
                  newExtractors[varName] = varPath;
                  updateNodeData('extractors', newExtractors);
                }} />
              </div>

              <FileUploadSection
                fileUploads={data.config?.fileUploads ?? []}
                onUpdate={(files: FileUpload[]) => updateNodeData('fileUploads', files)}
                variables={variables}
              />

              <div className="text-[9px] p-1.5 rounded-sm space-y-0.5 bg-[var(--aw-status-info)]/5 text-text-muted dark:text-text-muted-dark">
                <div><strong style={{ color: 'var(--aw-text-primary)' }}>Variable Reference:</strong></div>
                <div className="pl-2 space-y-0.5">
                  <div>&bull; Body: <code className="px-1 rounded" style={{ backgroundColor: 'var(--aw-surface-overlay)' }}>{`{{prev.response.body.token}}`}</code></div>
                  <div>&bull; Array: <code className="px-1 rounded" style={{ backgroundColor: 'var(--aw-surface-overlay)' }}>{`{{prev.response.body.data[0].city}}`}</code></div>
                  <div>&bull; Header: <code className="px-1 rounded" style={{ backgroundColor: 'var(--aw-surface-overlay)' }}>{`{{prev.response.headers.content-type}}`}</code></div>
                  <div>&bull; Cookie: <code className="px-1 rounded" style={{ backgroundColor: 'var(--aw-surface-overlay)' }}>{`{{prev.response.cookies.session}}`}</code></div>
                  {variables && Object.keys(variables).length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      <div className="font-semibold" style={{ color: 'var(--aw-status-success)' }}>Workflow Variables:</div>
                      {Object.keys(variables).map(v => (
                        <div key={v}>&bull; <code className="px-1 rounded" style={{ backgroundColor: 'var(--aw-surface-overlay)' }}>{`{{variables.${v}}}`}</code></div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <ResponsePreview result={data.executionResult} status={data.executionStatus} />
        </div>
      )}
    </BaseNode>
  );
};

export default memo(HTTPRequestNode);
