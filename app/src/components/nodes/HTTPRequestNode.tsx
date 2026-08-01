import { memo, useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useReactFlow } from "reactflow";
import { useWorkflow } from "../../contexts/WorkflowContext";
import { BaseNode } from "../atoms/flow/BaseNode";
import FileUploadSection from "../FileUploadSection";
import type { FileUpload } from "../../types/FileUpload";
import {
  Puzzle,
  Trash2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Snowflake,
  ExternalLink,
  Clock3,
  Globe,
} from "lucide-react";
import { formatDuration, formatSize } from "../../utils/formatNodeMetrics";
import { httpStatusText } from "../../utils/httpStatusText";
import { BeautifyButton } from "../molecules/BeautifyButton";
import {
  ExtractorForm,
  normalizeExtractorPath,
} from "../molecules/ExtractorForm";
import {
  countKeyValuePairs,
  previewBody,
  stringifyBody,
  stringifyKeyValuePairs,
} from "../node-modal/httpRequestConfigCompat";
import type { NodeStatus } from "../../types/NodeStatus";
import type { HttpMethod } from "@shared/types/HttpMethod";
import type {
  HTTPRequestNodeData,
  HTTPRequestNodeProps,
  SchemaWarning,
} from "../../types/HTTPRequestNodeProps";

const HTTP_METHODS: HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS",
];

const methodBadgeClasses: Record<HttpMethod, string> = {
  GET: "text-method-get bg-method-get/10 border-method-get/30",
  POST: "text-method-post bg-method-post/10 border-method-post/30",
  PUT: "text-method-put bg-method-put/10 border-method-put/30",
  DELETE: "text-method-delete bg-method-delete/10 border-method-delete/30",
  PATCH: "text-method-patch bg-method-patch/10 border-method-patch/30",
  HEAD: "text-method-head bg-method-head/10 border-method-head/30",
  OPTIONS: "text-method-options bg-method-options/10 border-method-options/30",
};

const formatRefreshTime = (isoValue: string | undefined): string => {
  if (!isoValue) return "Unavailable";
  const parsedDate = new Date(isoValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return isoValue;
  }
  return parsedDate.toLocaleString();
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
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside, {
      passive: true,
    });
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleWarningPopoverBlur = useCallback((event: React.FocusEvent) => {
    const nextFocusedElement = event.relatedTarget;
    if (!nextFocusedElement) return;
    if (
      wrapperRef.current &&
      !wrapperRef.current.contains(nextFocusedElement as Node)
    ) {
      setIsOpen(false);
    }
  }, []);

  const refreshedLabel = useMemo(
    () => formatRefreshTime(warning?.refreshedAt),
    [warning?.refreshedAt],
  );

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
        className="nodrag text-xs px-1.5 py-0.5 rounded-node-chip font-mono border border-status-warning/30 bg-status-warning/10 text-status-warning flex items-center gap-0.5 cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
        title={warning.text ?? "Swagger docs changed. Verify this request."}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-controls="schema-warning-popover"
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
        <div
          id="schema-warning-popover"
          role="dialog"
          aria-label="Swagger warning details"
          className="nodrag absolute top-full right-0 mt-1 z-[120] w-[260px] max-w-[calc(100vw-2rem)] rounded-node-ctl border border-[var(--aw-status-warning)] p-2 shadow-node bg-surface-raised dark:bg-surface-dark-raised"
        >
          <div className="text-xs font-semibold mb-1 text-[var(--aw-status-warning)]">
            Swagger Warning
          </div>
          <p className="text-xs leading-snug break-words text-text-primary dark:text-text-primary-dark">
            {warning.text}
          </p>

          <div className="mt-2 pt-2 border-t space-y-1 text-xs border-border dark:border-border-dark text-text-secondary dark:text-text-secondary-dark">
            <div className="flex items-center gap-1">
              <Clock3 className="w-3 h-3" />
              <span className="font-semibold">Refreshed:</span>
            </div>
            <div className="pl-4 text-text-primary dark:text-text-primary-dark">
              {refreshedLabel}
            </div>

            <div className="flex items-center gap-1 pt-1">
              <ExternalLink className="w-3 h-3" />
              <span className="font-semibold">Source:</span>
            </div>

            {warning.sourceUrl ? (
              <a
                href={warning.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="pl-4 block underline hover:opacity-80 break-all cursor-pointer text-[var(--aw-primary)] focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                title={warning.sourceUrl}
              >
                {warning.sourceUrl}
              </a>
            ) : (
              <div className="pl-4 text-[var(--aw-node-text-muted)]">
                Unavailable
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface ResponsePreviewProps {
  result: HTTPRequestNodeData["executionResult"];
  status: NodeStatus | undefined;
}

const ResponsePreview = ({ result, status }: ResponsePreviewProps) => {
  const [isBodyExpanded, setIsBodyExpanded] = useState(false);
  const [isBodyBeautified, setIsBodyBeautified] = useState(true);

  const bodyStr = useMemo(() => {
    if (!result?.body) return "";
    const raw =
      typeof result.body === "string"
        ? result.body
        : JSON.stringify(result.body, null, 2);
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

  // The status code, its reason phrase, the duration and the response size all
  // live in the run strip's summary and metrics row now. What is left here is
  // the detail the strip cannot hold: content type, cookies, and the body.
  const responseMetadata = [
    result.contentType,
    result.bodyFormat ? `body: ${result.bodyFormat}` : undefined,
  ].filter((metadata): metadata is string => Boolean(metadata));

  return (
    <div className="mt-2 pt-2 border-t border-border dark:border-border-dark">
      <div className="text-xs font-semibold mb-1 text-text-secondary dark:text-text-secondary-dark">
        Response
      </div>

      {responseMetadata.length > 0 && (
        <div className="mt-1 flex items-center gap-1 flex-wrap text-xs text-text-secondary dark:text-text-secondary-dark">
          {responseMetadata.map((metadata) => (
            <span
              key={metadata}
              className="px-1.5 py-0.5 rounded-node-chip bg-surface-overlay dark:bg-surface-dark-overlay"
            >
              {metadata}
            </span>
          ))}
        </div>
      )}

      {result.cookies && Object.keys(result.cookies).length > 0 && (
        <div className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
          <span className="font-semibold">Cookies:</span>
          <div className="pl-2 text-xs space-y-0.5 mt-0.5">
            {Object.entries(result.cookies).map(([key, value]) => (
              <div key={key}>
                <code className="px-1 rounded-node-chip bg-surface-overlay dark:bg-surface-dark-overlay">
                  {key}
                </code>
                : {value}
              </div>
            ))}
          </div>
        </div>
      )}

      {result.body && (
        <div
          className={`mt-1 rounded-node-ctl ${status === "error" ? "border border-status-error bg-[var(--aw-status-error)]/5" : ""}`}
        >
          <div
            className={`text-xs font-semibold mb-0.5 flex items-center justify-between ${status === "error" ? "text-[var(--aw-status-error)]" : "text-text-secondary dark:text-text-secondary-dark"}`}
          >
            <span>Body{status === "error" ? " (Error)" : ""}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleToggleBodyFormat}
                aria-label={isBodyBeautified ? "Minify JSON" : "Beautify JSON"}
                className="p-1.5 rounded transition-colors nodrag cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] motion-reduce:transition-none"
                title={isBodyBeautified ? "Minify JSON" : "Beautify JSON"}
              >
                <Puzzle className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => setIsBodyExpanded(!isBodyExpanded)}
                aria-label={
                  isBodyExpanded
                    ? "Collapse response body"
                    : "Expand response body"
                }
                className="p-1.5 rounded transition-colors nodrag cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] motion-reduce:transition-none"
                title={isBodyExpanded ? "Collapse" : "Expand"}
              >
                {isBodyExpanded ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>
            </div>
          </div>
          <textarea
            className={`w-full px-1.5 py-1 border text-xs font-mono nodrag rounded-node-ctl overflow-y-auto resize-y min-h-[100px] focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] ${
              status === "error"
                ? "bg-[var(--aw-status-error)]/5 border-[var(--aw-status-error)] text-[var(--aw-status-error)]"
                : "bg-surface-raised dark:bg-surface-dark-raised border-border dark:border-border-dark text-text-primary dark:text-text-primary-dark"
            }`}
            style={{ height: isBodyExpanded ? "600px" : "150px" }}
            aria-label="Response body"
            value={bodyStr}
            readOnly
            onFocus={(e) => e.target.select()}
          />
        </div>
      )}

      {result.error && (
        <div className="text-xs mt-1 p-1.5 rounded-node-ctl bg-[var(--aw-status-error)]/5 text-status-error dark:text-status-error-dark">
          <span className="font-semibold">Error:</span> {result.error}
        </div>
      )}
    </div>
  );
};

const HTTPRequestNode = ({ id, data, selected }: HTTPRequestNodeProps) => {
  const { setNodes } = useReactFlow();
  const { variables } = useWorkflow();

  const updateNodeData = useCallback(
    (field: string, value: unknown) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  config: { ...node.data.config, [field]: value },
                },
              }
            : node,
        ),
      );
    },
    [id, setNodes],
  );

  const method = (data.config?.method ?? "GET") as HttpMethod;
  const methodBadgeClass = methodBadgeClasses[method] ?? methodBadgeClasses.GET;

  const headerCount = countKeyValuePairs(data.config?.headers);
  const extractorCount = data.config?.extractors
    ? Object.keys(data.config.extractors).length
    : 0;
  const hasBody = data.config?.body && data.config?.method !== "GET";
  const bodyPreview = previewBody(data.config?.body);

  const icon = useMemo(() => <Globe className="w-4 h-4" />, []);

  // The method carries the node's identity hue, so the tile is method-coloured
  // and the chip repeats the name for anyone who cannot use the colour.
  const tileHue = `var(--aw-method-${method.toLowerCase()})`;

  const typeChip = useMemo(
    () => (
      <>
        {data.schemaRefreshWarning && (
          <SchemaWarningBadge warning={data.schemaRefreshWarning} />
        )}
        {data.branchCount && data.branchCount > 1 && (
          <span
            className="text-[11px] px-1.5 py-0.5 rounded-node-chip font-mono bg-surface-overlay dark:bg-surface-dark-overlay text-text-secondary dark:text-text-secondary-dark flex flex-shrink-0 items-center gap-0.5"
            title={`${data.branchCount} parallel branches`}
          >
            <Snowflake className="w-3 h-3" /> {data.branchCount}x
          </span>
        )}
        <span
          className={`flex-shrink-0 text-[11px] font-mono px-1.5 py-0.5 rounded-node-chip leading-none ${methodBadgeClass}`}
          title={`HTTP ${method}`}
        >
          {method}
        </span>
      </>
    ),
    [data.branchCount, data.schemaRefreshWarning, method, methodBadgeClass],
  );

  const status = data.executionStatus ?? "idle";
  const url = data.config?.url ?? "";
  const result = data.executionResult;
  const responseTime = result?.responseTimeMs ?? result?.duration;

  /** `200 OK`, `502 Bad Gateway`, or the transport error when there is no code. */
  const resultSummary = useMemo(() => {
    if (!result) return undefined;

    if (result.statusCode) {
      const phrase = httpStatusText(result.statusCode);
      return {
        operation: String(result.statusCode),
        ...(phrase && { argument: phrase }),
      };
    }

    if (result.error) return { operation: "failed", argument: result.error };

    return undefined;
  }, [result]);

  return (
    <BaseNode
      title={data.label ?? "HTTP Request"}
      icon={icon}
      tileHue={tileHue}
      status={status}
      selected={selected ?? false}
      nodeId={id}
      presetNodeType="http-request"
      handleLeft={{ type: "target" }}
      handleRight={{ type: "source" }}
      collapsible={true}
      defaultExpanded={false}
      typeChip={typeChip}
      restLine={{
        operation: method,
        ...(url ? { argument: url } : { argument: "no URL set" }),
      }}
      activityLine={{
        operation: method,
        ...(url && { argument: url }),
      }}
      {...(resultSummary && { resultSummary })}
      metrics={[
        {
          label: "status",
          value: result?.statusCode ? String(result.statusCode) : null,
        },
        { label: "duration", value: formatDuration(responseTime) },
        { label: "size", value: formatSize(result?.responseSizeBytes) },
      ]}
      progress={status === "running" ? "indeterminate" : null}
      className="max-w-[320px]"
    >
      {({ isExpanded }) =>
        !isExpanded ? null : (
        <div className="p-3 space-y-1.5">
          <div className="flex gap-1 items-start">
            <select
              aria-label="HTTP method"
              className={`nodrag px-2 py-1 border rounded-node-ctl text-xs font-mono focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] cursor-pointer ${methodBadgeClass}`}
              value={method}
              onChange={(e) => updateNodeData("method", e.target.value)}
            >
              {HTTP_METHODS.map((httpMethod) => (
                <option key={httpMethod} value={httpMethod}>
                  {httpMethod === "DELETE" ? "DEL" : httpMethod}
                </option>
              ))}
            </select>

            <textarea
              aria-label="Request URL"
              placeholder="Enter URL..."
              rows={2}
              className="nodrag flex-1 px-2 py-1 border border-border dark:border-border-dark rounded-node-ctl text-xs font-mono bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] resize-y min-h-[58px]"
              value={url}
              onChange={(e) => updateNodeData("url", e.target.value)}
            />
          </div>

          <div className="flex gap-1.5 text-[11px] flex-wrap text-[var(--aw-node-text-muted)]">
            {headerCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-node-chip bg-surface-overlay dark:bg-surface-dark-overlay">
                {headerCount} header{headerCount > 1 ? "s" : ""}
              </span>
            )}
            {extractorCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-node-chip bg-[color-mix(in_srgb,var(--aw-status-success)_12%,transparent)] text-[var(--aw-status-success)]">
                {extractorCount} extractor{extractorCount > 1 ? "s" : ""}
              </span>
            )}
            {hasBody && bodyPreview && (
              <span
                className="px-1.5 py-0.5 rounded-node-chip font-mono truncate max-w-full bg-surface-overlay dark:bg-surface-dark-overlay"
                title={stringifyBody(data.config?.body)}
              >
                {bodyPreview}
              </span>
            )}
          </div>

          {isExpanded && (
            <div className="space-y-1.5 pt-1 border-t border-border dark:border-border-dark">
              <div>
                <label
                  htmlFor="http-request-query-params"
                  className="block text-xs font-semibold mb-0.5 text-text-secondary dark:text-text-secondary-dark"
                >
                  Query Params{" "}
                  <span className="font-normal text-[var(--aw-node-text-muted)]">
                    (key=value)
                  </span>
                </label>
                <textarea
                  id="http-request-query-params"
                  aria-label="Query parameters"
                  className="nodrag w-full px-1.5 py-1 border rounded-node-ctl text-xs font-mono border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                  rows={2}
                  placeholder={"page=1\nlimit=10"}
                  value={stringifyKeyValuePairs(data.config?.queryParams)}
                  onChange={(e) =>
                    updateNodeData("queryParams", e.target.value)
                  }
                />
              </div>

              <div>
                <label
                  htmlFor="http-request-path-variables"
                  className="block text-xs font-semibold mb-0.5 text-text-secondary dark:text-text-secondary-dark"
                >
                  Path Variables{" "}
                  <span className="font-normal text-[var(--aw-node-text-muted)]">
                    (Use :varName in URL)
                  </span>
                </label>
                <textarea
                  id="http-request-path-variables"
                  aria-label="Path variables"
                  className="nodrag w-full px-1.5 py-1 border rounded-node-ctl text-xs font-mono border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                  rows={2}
                  placeholder={"userId={{prev.response.body.id}}"}
                  value={stringifyKeyValuePairs(data.config?.pathVariables)}
                  onChange={(e) =>
                    updateNodeData("pathVariables", e.target.value)
                  }
                />
              </div>

              <div>
                <label
                  htmlFor="http-request-headers"
                  className="block text-xs font-semibold mb-0.5 text-text-secondary dark:text-text-secondary-dark"
                >
                  Headers{" "}
                  <span className="font-normal text-[var(--aw-node-text-muted)]">
                    (key=value)
                  </span>
                </label>
                <textarea
                  id="http-request-headers"
                  aria-label="Headers"
                  className="nodrag w-full px-1.5 py-1 border rounded-node-ctl text-xs font-mono border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                  rows={2}
                  placeholder={
                    "Content-Type=application/json\nAuthorization=Bearer {{variables.token}}"
                  }
                  value={stringifyKeyValuePairs(data.config?.headers)}
                  onChange={(e) => updateNodeData("headers", e.target.value)}
                />
              </div>

              <div>
                <label
                  htmlFor="http-request-cookies"
                  className="block text-xs font-semibold mb-0.5 text-text-secondary dark:text-text-secondary-dark"
                >
                  Cookies{" "}
                  <span className="font-normal text-[var(--aw-node-text-muted)]">
                    (key=value)
                  </span>
                </label>
                <textarea
                  id="http-request-cookies"
                  aria-label="Cookies"
                  className="nodrag w-full px-1.5 py-1 border rounded-node-ctl text-xs font-mono border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                  rows={2}
                  placeholder={"session={{prev.response.cookies.session}}"}
                  value={stringifyKeyValuePairs(data.config?.cookies)}
                  onChange={(e) => updateNodeData("cookies", e.target.value)}
                />
              </div>

              {method !== "GET" && (
                <div>
                  <label
                    htmlFor="http-request-body"
                    className="block text-xs font-semibold mb-0.5 text-text-secondary dark:text-text-secondary-dark"
                  >
                    Body
                  </label>
                  <div className="relative">
                    <textarea
                      id="http-request-body"
                      aria-label="Request body"
                      className="nodrag w-full px-1.5 py-1 border rounded-node-ctl text-xs font-mono border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                      rows={3}
                      placeholder={'{\n  "key": "value"\n}'}
                      value={stringifyBody(data.config?.body)}
                      onChange={(e) => updateNodeData("body", e.target.value)}
                    />
                    <div className="absolute top-1 right-1">
                      <BeautifyButton
                        value={stringifyBody(data.config?.body)}
                        onChange={(val) => updateNodeData("body", val)}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label
                  htmlFor="http-request-timeout"
                  className="block text-xs font-semibold mb-0.5 text-text-secondary dark:text-text-secondary-dark"
                >
                  Timeout (seconds)
                </label>
                <input
                  id="http-request-timeout"
                  type="number"
                  aria-label="Timeout in seconds"
                  className="nodrag w-16 px-1.5 py-0.5 border rounded-node-ctl text-xs border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                  value={data.config?.timeout ?? 30}
                  onChange={(e) =>
                    updateNodeData("timeout", parseInt(e.target.value))
                  }
                  min="1"
                />
              </div>

              <div className="border-t pt-2 mt-2 border-border dark:border-border-dark">
                <div className="block text-xs font-semibold mb-1 flex items-center gap-1 text-text-secondary dark:text-text-secondary-dark">
                  <Puzzle className="w-3.5 h-3.5" />
                  <span>Store Response As Variables</span>
                </div>
                <div className="space-y-1 mb-2">
                  {data.config?.extractors &&
                  Object.entries(data.config.extractors).length > 0 ? (
                    Object.entries(data.config.extractors).map(
                      ([varName, varPath]) => {
                        const displayPath = normalizeExtractorPath(varPath);
                        return (
                          <div
                            key={varName}
                            className="flex gap-1 items-center text-xs"
                          >
                            <code className="px-1.5 py-0.5 rounded-node-chip flex-1 truncate bg-[var(--aw-status-success)]/10 text-status-success dark:text-status-success-dark">
                              {varName}
                            </code>
                            <span className="text-[var(--aw-node-text-muted)]">
                              &larr;
                            </span>
                            <code className="px-1.5 py-0.5 rounded-node-chip flex-1 truncate bg-[var(--aw-status-info)]/10 text-status-info dark:text-status-info-dark">
                              {displayPath}
                            </code>
                            <button
                              type="button"
                              className="nodrag flex-shrink-0 cursor-pointer text-[var(--aw-status-error)] focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                              onClick={() => {
                                const newExtractors = {
                                  ...data.config?.extractors,
                                };
                                delete newExtractors[varName];
                                updateNodeData("extractors", newExtractors);
                              }}
                              title="Delete extractor"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      },
                    )
                  ) : (
                    <div className="text-xs italic text-[var(--aw-node-text-muted)]">
                      No extractors configured
                    </div>
                  )}
                </div>
                <ExtractorForm
                  onAdd={(varName, varPath) => {
                    const newExtractors = {
                      ...(data.config?.extractors ?? {}),
                      [varName]: normalizeExtractorPath(varPath),
                    };
                    updateNodeData("extractors", newExtractors);
                  }}
                />
              </div>

              <FileUploadSection
                fileUploads={data.config?.fileUploads ?? []}
                onUpdate={(files: FileUpload[]) =>
                  updateNodeData("fileUploads", files)
                }
                variables={variables}
              />

              <div className="text-xs p-1.5 rounded-node-ctl space-y-0.5 bg-[var(--aw-status-info)]/5 text-[var(--aw-node-text-muted)]">
                <div>
                  <strong className="text-text-primary dark:text-text-primary-dark">
                    Variable Reference:
                  </strong>
                </div>
                <div className="pl-2 space-y-0.5">
                  <div>
                    &bull; Body:{" "}
                    <code
                      className="px-1 rounded-node-chip bg-surface-overlay dark:bg-surface-dark-overlay"
                    >{`{{prev.response.body.token}}`}</code>
                  </div>
                  <div>
                    &bull; Array:{" "}
                    <code
                      className="px-1 rounded-node-chip bg-surface-overlay dark:bg-surface-dark-overlay"
                    >{`{{prev.response.body.data[0].city}}`}</code>
                  </div>
                  <div>
                    &bull; Header:{" "}
                    <code
                      className="px-1 rounded-node-chip bg-surface-overlay dark:bg-surface-dark-overlay"
                    >{`{{prev.response.headers.content-type}}`}</code>
                  </div>
                  <div>
                    &bull; Cookie:{" "}
                    <code
                      className="px-1 rounded-node-chip bg-surface-overlay dark:bg-surface-dark-overlay"
                    >{`{{prev.response.cookies.session}}`}</code>
                  </div>
                  {variables && Object.keys(variables).length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      <div
                        className="font-semibold text-[var(--aw-status-success)]"
                      >
                        Workflow Variables:
                      </div>
                      {Object.keys(variables).map((v) => (
                        <div key={v}>
                          &bull;{" "}
                          <code
                            className="px-1 rounded-node-chip bg-surface-overlay dark:bg-surface-dark-overlay"
                          >{`{{variables.${v}}}`}</code>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <ResponsePreview
            result={data.executionResult}
            status={data.executionStatus}
          />
        </div>
        )
      }
    </BaseNode>
  );
};

export default memo(HTTPRequestNode);
