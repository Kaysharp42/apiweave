import { useMemo, useState } from "react";
import { Code2, Copy, FileText, Repeat, Timer } from "lucide-react";
import { Badge } from "../atoms/Badge";
import { IconButton } from "../atoms/IconButton";
import { ErrorBoundary } from "../molecules/ErrorBoundary";
import { ResponseInspector } from "../molecules/ResponseInspector";
import { SearchInput } from "../molecules/SearchInput";
import { SecretResolutionIndicator } from "../molecules/SecretResolutionIndicator";
import { formatNodeOutputDuration } from "../../utils/nodeOutputStatus";
import {
  createInspectorResponse,
  createInspectorMetadata,
  getRawBody,
  getNumberValue,
} from "./nodeModalUtils";
import { buildCurlCommand, buildFetchCommand } from "./copyAsCurl";
import { ScriptOutcomes } from "./ScriptOutcomes";
import type { HttpAttempt } from "@shared/types/HttpAttempt";
import type { ScriptOutcome } from "@shared/types/ScriptOutcome";
import type { AssertionEvaluation } from "@shared/types/AssertionEvaluation";
import type { ResolvedSecretInfo } from "@shared/types/ResolvedSecretInfo";
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
  extractors,
  onAddExtractor,
  onRemoveExtractor,
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
  // The runner stores at most the first 1 MiB of a body, and a body that is
  // not UTF-8 text as base64.
  const truncated = output?.truncated === true;
  const base64Body = output?.bodyEncoding === "base64";
  const requestLabel = `${initialConfig.method || "GET"} ${initialConfig.url || "Untitled request"}`;
  const outputRecord = output as Record<string, unknown> | null;
  const secretRefs = Array.isArray(outputRecord?.secretRefs)
    ? (outputRecord!.secretRefs as readonly string[])
    : [];
  const resolvedSecrets = outputRecord?.resolvedSecrets as readonly ResolvedSecretInfo[] | undefined;
  // Set only on a node with Retry: every request it sent; the response shown is the last one's.
  const attempts = Array.isArray(outputRecord?.attempts)
    ? (outputRecord!.attempts as readonly HttpAttempt[])
    : undefined;

  // Set only on a node with scripts: what each one did on this run.
  const scripts = Array.isArray(outputRecord?.scripts)
    ? (outputRecord!.scripts as readonly ScriptOutcome[])
    : [];

  // Set only on a node with responseSchemas: where the body broke the schema for its status.
  const schemaErrors = Array.isArray(outputRecord?.assertions)
    ? (outputRecord!.assertions as readonly AssertionEvaluation[]).flatMap(
        (rule) => rule.schemaErrors ?? [],
      )
    : [];

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
            {attempts && (
              <Badge
                variant="outline"
                size="sm"
                title={attempts
                  .map(
                    (attempt, index) =>
                      `#${index + 1}: ${attempt.statusCode ?? attempt.error ?? "no response"} · ${attempt.duration} ms`,
                  )
                  .join("\n")}
              >
                <Repeat className="h-3 w-3" />
                {attempts.length} {attempts.length === 1 ? "attempt" : "attempts"}
              </Badge>
            )}
            {truncated && (
              <Badge variant="warning" size="sm">
                Body truncated to first 1 MB
              </Badge>
            )}
            {base64Body && (
              <Badge variant="outline" size="sm">
                Binary body (base64)
              </Badge>
            )}
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
        {secretRefs.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted dark:text-text-muted-dark">
              Secrets
            </span>
            <SecretResolutionIndicator
              secretRefs={secretRefs}
              resolvedSecrets={resolvedSecrets}
            />
          </div>
        )}
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
        {schemaErrors.length > 0 && (
          <ul
            aria-label="Schema violations"
            className="mb-3 max-h-48 space-y-0.5 overflow-y-auto rounded-sm border border-border bg-surface-raised p-3 font-mono text-xs dark:border-border-dark dark:bg-surface-dark-raised"
          >
            {schemaErrors.map((violation, index) => (
              <li key={index} className="text-text-primary dark:text-text-primary-dark">
                <span className="text-status-error dark:text-status-error-dark">
                  {violation.path === "" ? "(root)" : violation.path}
                </span>{" "}
                {violation.message}
              </li>
            ))}
          </ul>
        )}
        {scripts.length > 0 && <ScriptOutcomes scripts={scripts} />}
        {/* A response the inspector cannot draw must not close the node
            editor and its unapplied draft. */}
        <ErrorBoundary name="response inspector">
          <ResponseInspector
            response={response}
            filterQuery={filterQuery}
            {...(metadata ? { metadata } : {})}
            {...(rawBody !== undefined ? { rawBody } : {})}
            {...(extractors ? { extractors } : {})}
            {...(onAddExtractor ? { onAddExtractor } : {})}
            {...(onRemoveExtractor ? { onRemoveExtractor } : {})}
          />
        </ErrorBoundary>
      </div>
    </div>
  );
}
