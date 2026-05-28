import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { JsonEditor } from 'json-edit-react';
import {
  Braces,
  Clock,
  Cookie,
  Copy,
  Eye,
  FileCode,
  Gauge,
  HardDriveDownload,
  ListFilter,
  Network,
  TableProperties,
  type LucideIcon,
} from 'lucide-react';
import type { ApiResponse, NodeResultMetadata, TabItem } from '../../types';
import { Badge } from '../atoms/Badge';
import { Button } from '../atoms/Button';
import { IconButton } from '../atoms/IconButton';
import { Input } from '../atoms/Input';
import { Card } from './Card';
import { EmptyState } from './EmptyState';
import { PanelTabs } from './PanelTabs';

export interface ResponseInspectorProps {
  response: ApiResponse | null;
  metadata?: NodeResultMetadata;
  rawBody?: string;
}

type ResponseInspectorTab = 'tree' | 'raw' | 'headers' | 'cookies' | 'preview' | 'timing';

interface CookieRow {
  name: string;
  value: string;
  attributes: string[];
  path?: string;
  domain?: string;
  expires?: string;
  sameSite?: string;
  secure: boolean;
  httpOnly: boolean;
}

type CardIcon = ComponentType<{ className?: string }>;

function createCardIcon(Icon: LucideIcon): CardIcon {
  return function CardIconComponent({ className }: { className?: string }) {
    return <Icon className={className} />;
  };
}

const BracesCardIcon = createCardIcon(Braces);
const ClockCardIcon = createCardIcon(Clock);
const CookieCardIcon = createCardIcon(Cookie);
const EyeCardIcon = createCardIcon(Eye);
const FileCodeCardIcon = createCardIcon(FileCode);
const GaugeCardIcon = createCardIcon(Gauge);
const HardDriveDownloadCardIcon = createCardIcon(HardDriveDownload);
const ListFilterCardIcon = createCardIcon(ListFilter);
const NetworkCardIcon = createCardIcon(Network);

const RESPONSE_TABS: TabItem[] = [
  { key: 'tree', icon: Braces, label: 'Tree' },
  { key: 'raw', icon: FileCode, label: 'Raw' },
  { key: 'headers', icon: TableProperties, label: 'Headers' },
  { key: 'cookies', icon: Cookie, label: 'Cookies' },
  { key: 'preview', icon: Eye, label: 'Preview' },
  { key: 'timing', icon: Gauge, label: 'Timing' },
];

function normalizeHeaderName(name: string): string {
  return name.trim().toLowerCase();
}

function getHeader(headers: Record<string, string>, headerName: string): string | undefined {
  const normalizedHeaderName = normalizeHeaderName(headerName);
  return Object.entries(headers).find(([key]) => normalizeHeaderName(key) === normalizedHeaderName)?.[1];
}

function getEffectiveMetadata(
  response: ApiResponse | null,
  metadata: NodeResultMetadata | undefined,
): NodeResultMetadata | undefined {
  return metadata ?? response?.metadata;
}

function getContentType(response: ApiResponse | null, metadata: NodeResultMetadata | undefined): string {
  const effectiveMetadata = getEffectiveMetadata(response, metadata);
  return (effectiveMetadata?.contentType || (response ? getHeader(response.headers, 'content-type') : '') || '').toLowerCase();
}

function isJsonContent(contentType: string, body: unknown, bodyFormat?: string): boolean {
  return bodyFormat?.toLowerCase() === 'json'
    || contentType.includes('json')
    || typeof body === 'object';
}

function isHtmlContent(contentType: string, bodyFormat?: string): boolean {
  return bodyFormat?.toLowerCase() === 'html' || contentType.includes('text/html');
}

function isImageContent(contentType: string, bodyFormat?: string): boolean {
  return bodyFormat?.toLowerCase() === 'image' || contentType.startsWith('image/');
}

function isTextContent(contentType: string, bodyFormat?: string): boolean {
  const normalizedBodyFormat = bodyFormat?.toLowerCase();
  return normalizedBodyFormat === 'text'
    || normalizedBodyFormat === 'xml'
    || normalizedBodyFormat === 'html'
    || contentType.startsWith('text/')
    || contentType.includes('xml')
    || contentType.includes('javascript')
    || contentType.includes('x-www-form-urlencoded');
}

function isBinaryContent(contentType: string, bodyFormat?: string): boolean {
  const normalizedBodyFormat = bodyFormat?.toLowerCase();
  return normalizedBodyFormat === 'binary'
    || contentType.includes('octet-stream')
    || contentType.includes('application/pdf')
    || contentType.includes('application/zip');
}

function getDefaultTab(response: ApiResponse | null, metadata: NodeResultMetadata | undefined): ResponseInspectorTab {
  if (!response) return 'tree';

  const contentType = getContentType(response, metadata);
  const bodyFormat = getEffectiveMetadata(response, metadata)?.bodyFormat;

  if (isJsonContent(contentType, response.body, bodyFormat)) return 'tree';
  if (isHtmlContent(contentType, bodyFormat) || isImageContent(contentType, bodyFormat)) return 'preview';
  if (isTextContent(contentType, bodyFormat)) return 'raw';
  return 'preview';
}

function stringifyBody(body: unknown, rawBody?: string): string {
  if (rawBody !== undefined) return rawBody;
  if (typeof body === 'string') return body;
  if (body === null || body === undefined) return '';

  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return 'Not captured';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function getCookieAttributeValue(attributes: Record<string, string | boolean>, attributeName: string): string | undefined {
  const entry = Object.entries(attributes).find(([key]) => key.toLowerCase() === attributeName.toLowerCase());
  if (!entry) return undefined;

  const value = entry[1];
  if (typeof value === 'string') return value;
  return value ? 'true' : undefined;
}

function hasCookieAttribute(attributes: Record<string, string | boolean>, attributeName: string): boolean {
  const entry = Object.entries(attributes).find(([key]) => key.toLowerCase() === attributeName.toLowerCase());
  if (!entry) return false;

  return entry[1] === true || entry[1] === 'true' || entry[1] === '';
}

function formatCookieAttributes(attributes: Record<string, string | boolean>): string[] {
  return Object.entries(attributes)
    .filter((entry): entry is [string, string | boolean] => entry[1] !== undefined && entry[1] !== null)
    .map(([key, value]) => (typeof value === 'boolean' ? key : `${key}=${value}`));
}

function getStructuredCookieRows(response: ApiResponse | null): CookieRow[] {
  if (!response?.cookies?.length) return [];

  return response.cookies.map((cookie) => {
    const row: CookieRow = {
      name: cookie.name,
      value: cookie.value,
      attributes: formatCookieAttributes(cookie.attributes),
      secure: hasCookieAttribute(cookie.attributes, 'secure'),
      httpOnly: hasCookieAttribute(cookie.attributes, 'httponly'),
    };

    const path = getCookieAttributeValue(cookie.attributes, 'path');
    if (path !== undefined) row.path = path;

    const domain = getCookieAttributeValue(cookie.attributes, 'domain');
    if (domain !== undefined) row.domain = domain;

    const expires = getCookieAttributeValue(cookie.attributes, 'expires');
    if (expires !== undefined) row.expires = expires;

    const sameSite = getCookieAttributeValue(cookie.attributes, 'samesite');
    if (sameSite !== undefined) row.sameSite = sameSite;

    return row;
  });
}

function splitSetCookieHeader(value: string): string[] {
  return value
    .split(/,(?=\s*[^;,=]+=[^;,]+)/)
    .flatMap((candidate) => candidate.split(/\r?\n/).reduce<string[]>((entries, entry) => {
      const trimmed = entry.trim();
      if (trimmed) entries.push(trimmed);
      return entries;
    }, []));
}

function parseCookie(value: string): CookieRow | null {
  const [nameValue, ...attributePairs] = value.split(';').map((part) => part.trim());
  if (!nameValue) return null;

  const separatorIndex = nameValue.indexOf('=');
  if (separatorIndex < 1) return null;

  const cookie: CookieRow = {
    name: nameValue.slice(0, separatorIndex),
    value: nameValue.slice(separatorIndex + 1),
    attributes: [],
    secure: false,
    httpOnly: false,
  };

  attributePairs.forEach((attributePair) => {
    const [rawKey, ...rawValueParts] = attributePair.split('=');
    const key = rawKey?.trim().toLowerCase();
    const attributeValue = rawValueParts.join('=').trim();
    if (rawKey) {
      cookie.attributes.push(rawValueParts.length > 0 ? `${rawKey.trim()}=${attributeValue}` : rawKey.trim());
    }

    if (key === 'secure') cookie.secure = true;
    if (key === 'httponly') cookie.httpOnly = true;
    if (key === 'samesite') cookie.sameSite = attributeValue;
    if (key === 'path') cookie.path = attributeValue;
    if (key === 'domain') cookie.domain = attributeValue;
    if (key === 'expires') cookie.expires = attributeValue;
  });

  return cookie;
}

function getCookieRows(response: ApiResponse | null): CookieRow[] {
  if (!response) return [];

  const structuredCookieRows = getStructuredCookieRows(response);
  if (structuredCookieRows.length > 0) return structuredCookieRows;

  const setCookieHeader = getHeader(response.headers, 'set-cookie');
  if (!setCookieHeader) return [];

  return splitSetCookieHeader(setCookieHeader)
    .map(parseCookie)
    .filter((cookie): cookie is CookieRow => cookie !== null);
}

function getImageSource(contentType: string, bodyText: string): string {
  if (bodyText.startsWith('data:')) return bodyText;
  return `data:${contentType || 'image/*'};base64,${bodyText}`;
}

function getMetricRows(response: ApiResponse, metadata: NodeResultMetadata | undefined, bodyText: string) {
  const responseSizeBytes = metadata?.responseSizeBytes ?? byteLength(bodyText);
  const responseTimeMs = metadata?.responseTimeMs ?? response.responseTime;

  return [
    { label: 'Response time', value: `${responseTimeMs} ms`, icon: ClockCardIcon },
    { label: 'Duration', value: `${response.responseTime} ms`, icon: GaugeCardIcon },
    { label: 'Request size', value: 'Not captured', icon: NetworkCardIcon },
    { label: 'Response size', value: formatBytes(responseSizeBytes), icon: HardDriveDownloadCardIcon },
  ];
}

export function ResponseInspector({
  response,
  metadata,
  rawBody,
}: ResponseInspectorProps) {
  const [activeTab, setActiveTab] = useState<ResponseInspectorTab>(() => getDefaultTab(response, metadata));
  const [headerFilter, setHeaderFilter] = useState('');
  const [copied, setCopied] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      return document.documentElement.classList.contains('dark');
    } catch {
      return false;
    }
  });

  const effectiveMetadata = getEffectiveMetadata(response, metadata);
  const contentType = getContentType(response, metadata);
  const bodyText = useMemo(() => stringifyBody(response?.body, rawBody), [response?.body, rawBody]);
  const cookieRows = useMemo(() => getCookieRows(response), [response]);
  const filteredHeaders = useMemo(() => {
    if (!response) return [];

    const normalizedFilter = headerFilter.trim().toLowerCase();
    return Object.entries(response.headers).filter(([key, value]) => {
      if (!normalizedFilter) return true;
      return key.toLowerCase().includes(normalizedFilter) || value.toLowerCase().includes(normalizedFilter);
    });
  }, [headerFilter, response]);

  useEffect(() => {
    const root = document.documentElement;
    const syncDarkMode = () => {
      setIsDarkMode(root.classList.contains('dark'));
    };

    const observer = new MutationObserver(syncDarkMode);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });

    return () => observer.disconnect();
  }, []);

  const jsonEditorTheme = useMemo(() => {
    if (!isDarkMode) return undefined;

    return {
      container: {
        backgroundColor: 'var(--color-surface-dark-raised)',
        color: 'var(--color-text-primary-dark)',
      },
      collection: { backgroundColor: 'transparent' },
      collectionInner: { backgroundColor: 'transparent' },
      collectionElement: { backgroundColor: 'transparent' },
      property: { color: 'var(--color-text-primary-dark)' },
      bracket: { color: 'var(--color-text-secondary-dark)' },
      itemCount: { color: 'var(--color-text-muted-dark)' },
      iconCollection: { color: 'var(--aw-primary)' },
      string: { color: 'var(--color-success)' },
      number: { color: 'var(--color-info)' },
      boolean: { color: 'var(--color-primary-dark)' },
      null: { color: 'var(--color-warning)' },
      input: {
        backgroundColor: 'var(--color-surface-dark-overlay)',
        color: 'var(--color-text-primary-dark)',
        border: '1px solid var(--color-border-dark)',
      },
      inputHighlight: { backgroundColor: 'var(--color-surface-dark-overlay)' },
      error: { color: 'var(--color-error)' },
    } as const;
  }, [isDarkMode]);

  if (!response) {
    return (
      <Card title="Response inspector" icon={EyeCardIcon}>
        <div className="rounded-lg border border-dashed border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay">
          <EmptyState
            icon={<Gauge className="h-10 w-10 text-text-muted dark:text-text-muted-dark" strokeWidth={1.75} />}
            title="No response captured yet"
            description="Run this HTTP node and select a completed execution to inspect headers, body, cookies, and timing details."
            className="min-h-40 py-8"
          />
        </div>
      </Card>
    );
  }

  const bodyFormat = effectiveMetadata?.bodyFormat;
  const treeData = response.body ?? null;
  const metricRows = getMetricRows(response, effectiveMetadata, bodyText);
  const showJsonPreview = isJsonContent(contentType, response.body, bodyFormat);
  const showHtmlPreview = isHtmlContent(contentType, bodyFormat);
  const showImagePreview = isImageContent(contentType, bodyFormat);
  const showTextPreview = isTextContent(contentType, bodyFormat);
  const showBinaryPreview = isBinaryContent(contentType, bodyFormat);

  const handleCopyBody = async (): Promise<void> => {
    await navigator.clipboard.writeText(bodyText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const renderHeaders = () => (
    <div className="space-y-4">
      <Card title={`Headers (${filteredHeaders.length})`} icon={ListFilterCardIcon}>
        <div className="space-y-3">
          <Input
            size="sm"
            value={headerFilter}
            onChange={(event) => setHeaderFilter(event.target.value)}
            placeholder="Filter headers by name or value"
            aria-label="Filter response headers"
          />

          <div className="overflow-auto rounded-lg border border-border dark:border-border-dark">
            <table className="min-w-full divide-y divide-border dark:divide-border-dark text-sm">
              <thead className="bg-surface-overlay dark:bg-surface-dark-overlay text-left text-xs uppercase tracking-wide text-text-secondary dark:text-text-secondary-dark">
                <tr>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border dark:divide-border-dark text-text-primary dark:text-text-primary-dark">
                {filteredHeaders.map(([key, value]) => (
                  <tr key={key}>
                    <td className="px-3 py-2 align-top font-mono text-xs font-semibold text-primary dark:text-primary-light">{key}</td>
                    <td className="px-3 py-2 align-top font-mono text-xs break-all">{value}</td>
                  </tr>
                ))}
                {filteredHeaders.length === 0 && (
                  <tr>
                    <td colSpan={2} className="px-3 py-6 text-center text-sm text-text-secondary dark:text-text-secondary-dark">
                      No headers match the current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </div>
  );

  const renderCookies = () => (
    <Card title={`Cookies (${cookieRows.length})`} icon={CookieCardIcon}>
      <div className="overflow-auto rounded-lg border border-border dark:border-border-dark">
        <table className="min-w-full divide-y divide-border dark:divide-border-dark text-sm">
          <thead className="bg-surface-overlay dark:bg-surface-dark-overlay text-left text-xs uppercase tracking-wide text-text-secondary dark:text-text-secondary-dark">
            <tr>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Value</th>
              <th className="px-3 py-2 font-semibold">Attributes</th>
              <th className="px-3 py-2 font-semibold">Path</th>
              <th className="px-3 py-2 font-semibold">Domain</th>
              <th className="px-3 py-2 font-semibold">Expires</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border dark:divide-border-dark text-text-primary dark:text-text-primary-dark">
            {cookieRows.map((cookieRow) => (
              <tr key={`${cookieRow.name}-${cookieRow.domain ?? ''}-${cookieRow.path ?? ''}`}>
                <td className="px-3 py-2 align-top font-mono text-xs font-semibold text-primary dark:text-primary-light">{cookieRow.name}</td>
                <td className="px-3 py-2 align-top font-mono text-xs break-all">{cookieRow.value}</td>
                <td className="px-3 py-2 align-top">
                  <div className="flex flex-wrap gap-1.5">
                    {cookieRow.attributes.map((attribute) => (
                      <Badge key={`${cookieRow.name}-${attribute}`} variant="outline" size="xs">{attribute}</Badge>
                    ))}
                    {cookieRow.attributes.length === 0 && (
                      <span className="text-xs text-text-muted dark:text-text-muted-dark">None</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 align-top font-mono text-xs">{cookieRow.path ?? '--'}</td>
                <td className="px-3 py-2 align-top font-mono text-xs">{cookieRow.domain ?? '--'}</td>
                <td className="px-3 py-2 align-top font-mono text-xs">{cookieRow.expires ?? '--'}</td>
              </tr>
            ))}
                {cookieRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-sm text-text-secondary dark:text-text-secondary-dark">
                      No cookies were returned.
                    </td>
                  </tr>
                )}
          </tbody>
        </table>
      </div>
    </Card>
  );

  const renderPreview = () => {
    if (showJsonPreview) {
      return (
        <Card title="JSON preview" icon={BracesCardIcon} className="flex min-h-0 flex-col [&>:last-child]:min-h-0 [&>:last-child]:flex-1">
          <div className="h-full overflow-auto rounded-lg border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised p-3">
            <JsonEditor
              data={treeData}
              restrictEdit={true}
              restrictAdd={true}
              restrictDelete={true}
              rootName="body"
              {...(jsonEditorTheme ? { theme: jsonEditorTheme } : {})}
            />
          </div>
        </Card>
      );
    }

    if (showHtmlPreview) {
      return (
        <Card title="HTML preview" icon={EyeCardIcon}>
          <iframe
            title="Response HTML preview"
            srcDoc={bodyText}
            sandbox="allow-scripts"
            className="h-96 w-full rounded-lg border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised"
          />
        </Card>
      );
    }

    if (showImagePreview) {
      return (
        <Card title="Image preview" icon={EyeCardIcon}>
          <div className="flex min-h-64 items-center justify-center rounded-lg border border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay p-4">
            <img src={getImageSource(contentType, bodyText)} alt="Response preview" className="max-h-96 max-w-full object-contain" />
          </div>
        </Card>
      );
    }

    if (showTextPreview && !showBinaryPreview) {
      return (
        <Card title="Text preview" icon={FileCodeCardIcon}>
          <pre className="max-h-96 overflow-auto rounded-lg border border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay p-3 font-mono text-xs text-text-primary dark:text-text-primary-dark whitespace-pre-wrap break-words">
            {bodyText}
          </pre>
        </Card>
      );
    }

    return (
      <Card title="Binary preview" icon={HardDriveDownloadCardIcon}>
        <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay p-6 text-center">
          <HardDriveDownload className="h-8 w-8 text-text-secondary dark:text-text-secondary-dark" />
            <p className="text-sm font-medium text-text-primary dark:text-text-primary-dark">Binary content -- download to view</p>
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark">Preview is disabled for non-text response bodies.</p>
        </div>
      </Card>
    );
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={response.status >= 200 && response.status < 400 ? 'success' : 'error'} size="sm">
            {response.status}
          </Badge>
          {contentType && <Badge variant="outline" size="sm">{contentType}</Badge>}
          <Badge variant="outline" size="sm">
            <Clock className="mr-1 h-3 w-3" />
            {effectiveMetadata?.responseTimeMs ?? response.responseTime} ms
          </Badge>
          {effectiveMetadata?.redirectCount !== undefined && effectiveMetadata.redirectCount > 0 && (
            <Badge variant="info" size="sm">{effectiveMetadata.redirectCount} redirects</Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setActiveTab(getDefaultTab(response, metadata))}>
          Auto tab
        </Button>
      </div>

      <PanelTabs tabs={RESPONSE_TABS} activeTab={activeTab} onTabChange={(key) => setActiveTab(key as ResponseInspectorTab)} />

      <div id={`panel-tab-${activeTab}`} role="tabpanel" className="flex flex-1 min-h-0 flex-col gap-4">
        {activeTab === 'tree' && (
          <Card title="Response body tree" icon={BracesCardIcon} className="flex min-h-0 flex-col [&>:last-child]:min-h-0 [&>:last-child]:flex-1">
            <div className="h-full overflow-auto rounded-lg border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised p-3">
              <JsonEditor
                data={treeData}
                restrictEdit={true}
                restrictAdd={true}
                restrictDelete={true}
                rootName="body"
                {...(jsonEditorTheme ? { theme: jsonEditorTheme } : {})}
              />
            </div>
          </Card>
        )}

        {activeTab === 'raw' && (
          <Card
            title="Raw body"
            icon={FileCodeCardIcon}
            className="flex min-h-0 flex-col [&>:last-child]:min-h-0 [&>:last-child]:flex-1"
            headerActions={(
              <IconButton tooltip={copied ? 'Copied' : 'Copy raw body'} size="sm" onClick={() => void handleCopyBody()}>
                <Copy className="h-4 w-4" />
              </IconButton>
            )}
          >
            <pre className="h-full overflow-auto rounded-lg border border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay p-3 font-mono text-xs text-text-primary dark:text-text-primary-dark whitespace-pre-wrap break-words">
              {bodyText}
            </pre>
          </Card>
        )}

        {activeTab === 'headers' && renderHeaders()}
        {activeTab === 'cookies' && renderCookies()}
        {activeTab === 'preview' && renderPreview()}
        {activeTab === 'timing' && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metricRows.map((metricRow) => {
              const Icon = metricRow.icon;
              return (
                <Card key={metricRow.label} title={metricRow.label} icon={Icon}>
                  <p className="font-mono text-lg font-semibold text-text-primary dark:text-text-primary-dark">{metricRow.value}</p>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
