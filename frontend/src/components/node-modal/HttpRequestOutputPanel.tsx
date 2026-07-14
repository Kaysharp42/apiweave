import { useMemo, useState } from "react";
import { Code2, Copy, FileText, Timer } from "lucide-react";
import { Badge } from "../atoms/Badge";
import { IconButton } from "../atoms/IconButton";
import { ResponseInspector } from "../molecules/ResponseInspector";
import { SearchInput } from "../molecules/SearchInput";
import { formatNodeOutputDuration } from "../../utils/nodeOutputStatus";
import {
  createInspectorResponse,
  createInspectorMetadata,
  getRawBody,
  getNumberValue,
} from "./nodeModalUtils";
import { buildCurlCommand, buildFetchCommand } from "./copyAsCurl";
import type { BadgeProps, HttpRequestOutputPanelProps } from "../../types";

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return "Size unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function statusVariant(
  statusCode: number | undefined,
): NonNullable<BadgeProps["variant"]> {
  if (statusCode === undefined) return "secondary";
  if (statusCode >= 200 && statusCode < 300) return "success";
  if (statusCode >= 300 && statusCode < 400) return "info";
  if (statusCode >= 400 && statusCode < 500) return "warning";
  if (statusCode >= 500) return "error";
  return "secondary";
}

export function HttpRequestOutputPanel({
  node,
  initialConfig,
  output,
}: HttpRequestOutputPanelProps) {
  const [filterQuery, setFilterQuery] = useState("");
  const [copyLabel, setCopyLabel] = useState<string | null>(null);
  const response = output ? createInspectorResponse(output) : null;
  const metadata = output
    ? createInspectorMetadata(output, response)
    : undefined;
  const rawBody = output ? getRawBody(output) : undefined;
  const errorText =
    typeof output?.error === "string"
      ? output.error
      : typeof output?.message === "string"
        ? output.message
        : undefined;
  const statusCode = response?.status;
  const durationLabel = formatNodeOutputDuration(
    metadata?.responseTimeMs ?? getNumberValue(output ?? undefined, "duration"),
  );
  const responseSize = formatBytes(metadata?.responseSizeBytes);
  const requestLabel = `${initialConfig.method || "GET"} ${initialConfig.url || "Untitled request"}`;

  const commands = useMemo(
    () => ({
      curl: buildCurlCommand(initialConfig),
      fetch: buildFetchCommand(initialConfig),
    }),
    [initialConfig],
  );

  const copyCommand = async (kind: "curl" | "fetch") => {
    await navigator.clipboard.writeText(commands[kind]);
    setCopyLabel(kind);
    window.setTimeout(() => setCopyLabel(null), 1200);
  };

  if (!output || node.type !== "http-request") {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-surface-raised p-6 dark:bg-surface-dark-raised">
        <div className="text-center">
          <FileText className="mx-auto mb-4 h-16 w-16 text-text-muted dark:text-text-muted-dark/70" />
          <p className="mb-2 text-sm text-text-muted dark:text-text-muted-dark">
            Execute this node to view data
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface dark:bg-surface-dark">
      <div className="flex flex-shrink-0 flex-col gap-3 border-b border-border bg-surface-raised px-4 py-3 dark:border-border-dark dark:bg-surface-dark-raised">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant={statusVariant(statusCode)} size="sm">
              {statusCode || "—"}
            </Badge>
            {durationLabel && (
              <Badge variant="outline" size="sm">
                <Timer className="h-3 w-3" />
                {durationLabel}
              </Badge>
            )}
            <Badge variant="outline" size="sm">
              {responseSize}
            </Badge>
            <span className="min-w-0 truncate font-mono text-xs text-text-secondary dark:text-text-secondary-dark">
              {requestLabel}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <IconButton
              tooltip={copyLabel === "curl" ? "Copied cURL" : "Copy as cURL"}
              size="sm"
              variant="secondary"
              onClick={() => void copyCommand("curl")}
            >
              <Copy className="h-4 w-4" />
            </IconButton>
            <IconButton
              tooltip={copyLabel === "fetch" ? "Copied fetch" : "Copy as fetch"}
              size="sm"
              variant="secondary"
              onClick={() => void copyCommand("fetch")}
            >
              <Code2 className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
        <SearchInput
          value={filterQuery}
          onChange={setFilterQuery}
          placeholder="Search response keys or values"
          size="sm"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-surface p-4 dark:bg-surface-dark">
        {errorText && (
          <div className="mb-3 rounded-sm border border-status-error bg-[var(--aw-status-error)]/5 p-3 text-sm text-status-error dark:text-status-error-dark">
            <span className="font-semibold">Error:</span> {errorText}
          </div>
        )}
        <ResponseInspector
          response={response}
          filterQuery={filterQuery}
          {...(metadata ? { metadata } : {})}
          {...(rawBody !== undefined ? { rawBody } : {})}
        />
      </div>
    </div>
  );
}
