import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { usePalette } from "../contexts/PaletteContext";
import { authenticatedFetch } from "../utils/apiweaveClient";
import { buildSwaggerRefreshSummary } from "../utils/swaggerRefreshSummary";
import { useScopeContext } from "../hooks/useScopeContext";
import { workflowImportOpenapiRemoteUrl } from "../utils/apiweaveClient";
import type { Node } from "reactflow";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";
import type { ScopedEnvironment } from "../types/ScopedEnvironment";
import type { ImportedItem } from "../types/ImportedItem";
import type { SwaggerRefreshResult } from "../types/SwaggerRefreshResult";

interface SwaggerImportPayload {
  nodes?: Array<{ label?: string; config?: Record<string, unknown> }>;
  stats?: Record<string, unknown>;
}

// Every open workflow gets its own useSwaggerRefresh instance, but a Swagger
// doc URL is scoped to a workspace, not a workflow — opening several
// workflows that share an environment (common with a 10+-service doc) has no
// reason to re-fetch and re-parse the same spec for each one. This
// module-level cache (keyed by workspace+URL) and in-flight map are shared
// across every instance so only the first open per TTL window pays for the
// network round trip and server-side parse; the rest reuse the result.
export const SWAGGER_CACHE_TTL_MS = 5 * 60 * 1000;
export const MAX_SWAGGER_CACHE_ENTRIES = 50;
const swaggerResultCache = new Map<
  string,
  { result: SwaggerImportPayload; fetchedAt: number }
>();
const swaggerInFlight = new Map<string, Promise<SwaggerImportPayload>>();

export function swaggerCacheKey(workspaceId: string, swaggerDocUrl: string) {
  return `${workspaceId}::${swaggerDocUrl}`;
}

// Which signature (workflow+env+url) was last applied to a given workflow's
// canvas/palette. Keyed by workflowId, not held in a ref: a ref resets on
// every mount, so switching to another workflow and back — or an unrelated
// re-render (e.g. the sidebar's window-focus/visibilitychange handler
// reloading `environments`) — was treating the return as "first refresh" and
// re-running the full apply (addImportedGroup + a pass over every canvas
// node) even though nothing had changed. Module scope survives the remount,
// so an unchanged signature is skipped for real.
const MAX_SWAGGER_SIGNATURE_ENTRIES = 100;
const swaggerAppliedSignatureByWorkflow = new Map<string, string>();

function rememberSwaggerSignature(workflowKey: string, signature: string) {
  // Refresh LRU order for existing keys so the eviction below drops the
  // least-recently-used workflow first.
  if (swaggerAppliedSignatureByWorkflow.has(workflowKey)) {
    swaggerAppliedSignatureByWorkflow.delete(workflowKey);
  } else if (
    swaggerAppliedSignatureByWorkflow.size >= MAX_SWAGGER_SIGNATURE_ENTRIES
  ) {
    const oldest = swaggerAppliedSignatureByWorkflow.keys().next();
    if (!oldest.done) {
      swaggerAppliedSignatureByWorkflow.delete(oldest.value);
    }
  }
  swaggerAppliedSignatureByWorkflow.set(workflowKey, signature);
}

function storeSwaggerResult(cacheKey: string, result: SwaggerImportPayload) {
  const now = Date.now();
  for (const [key, entry] of swaggerResultCache) {
    if (now - entry.fetchedAt >= SWAGGER_CACHE_TTL_MS) {
      swaggerResultCache.delete(key);
    }
  }
  if (
    !swaggerResultCache.has(cacheKey) &&
    swaggerResultCache.size >= MAX_SWAGGER_CACHE_ENTRIES
  ) {
    const oldest = swaggerResultCache.keys().next();
    if (!oldest.done) {
      swaggerResultCache.delete(oldest.value);
    }
  }
  swaggerResultCache.set(cacheKey, { result, fetchedAt: now });
}

/** Test-only: clears the shared cache/in-flight state between test cases. */
export function __clearSwaggerCacheForTests() {
  swaggerResultCache.clear();
  swaggerInFlight.clear();
  swaggerAppliedSignatureByWorkflow.clear();
}

export async function fetchSwaggerNodes(
  requestUrl: string,
  cacheKey: string,
  force: boolean,
): Promise<SwaggerImportPayload> {
  if (!force) {
    const cached = swaggerResultCache.get(cacheKey);
    if (cached) {
      if (Date.now() - cached.fetchedAt < SWAGGER_CACHE_TTL_MS) {
        return cached.result;
      }
      swaggerResultCache.delete(cacheKey);
    }
    const pending = swaggerInFlight.get(cacheKey);
    if (pending) return pending;
  }

  const promise = (async () => {
    const response = await authenticatedFetch(requestUrl);
    if (!response.ok) {
      let detail = "Failed to load Swagger/OpenAPI URL";
      try {
        const errorBody = (await response.json()) as { detail?: string };
        detail = errorBody.detail || detail;
      } catch {
        // Keep default error detail if response body is not JSON
      }
      throw new Error(detail);
    }
    const parsed = (await response.json()) as SwaggerImportPayload;
    storeSwaggerResult(cacheKey, parsed);
    return parsed;
  })();

  swaggerInFlight.set(cacheKey, promise);
  promise
    .finally(() => {
      if (swaggerInFlight.get(cacheKey) === promise) {
        swaggerInFlight.delete(cacheKey);
      }
    })
    .catch(() => {
      // Already surfaced to the real awaiter below; this chain only exists to
      // clear the in-flight entry and must not become an unhandled rejection.
    });

  return promise;
}

// Loopback/private/link-local targets are only fetched on an explicit,
// user-initiated refresh (force=true) — never from the automatic mount
// effect. swaggerDocUrl is environment data that can arrive via import/sync,
// so the automatic path must not silently issue requests to local services.
export function isSensitiveAutoRefreshTarget(rawUrl: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "host.docker.internal" || host === "0.0.0.0" || host === "::1") {
    return true;
  }
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 127 || a === 10 || a === 169 /* link-local/metadata */ || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return true;
    }
  }
  return false;
}

interface UseSwaggerRefreshParams {
  workflowId: string | undefined;
  selectedEnvironment: string | null;
  environments: ScopedEnvironment[];
  setNodes: React.Dispatch<
    React.SetStateAction<Node<WorkflowCanvasNodeData>[]>
  >;
}

export function useSwaggerRefresh({
  workflowId,
  selectedEnvironment,
  environments,
  setNodes,
}: UseSwaggerRefreshParams) {
  const { addImportedGroup, removeImportedGroup } = usePalette();
  const { workspaceId, isReady } = useScopeContext();
  const [isSwaggerRefreshing, setIsSwaggerRefreshing] = useState(false);
  const swaggerRefreshRequestIdRef = useRef(0);
  const envSwaggerGroupId = `env-openapi-${workflowId}`;

  const clearSwaggerWarningOnCanvas = useCallback(() => {
    setNodes((currentNodes) => {
      let didChange = false;
      const nextNodes = currentNodes.map((node) => {
        if (node.type !== "http-request" || !node.data?.schemaRefreshWarning) {
          return node;
        }
        const restData = { ...node.data };
        delete restData.schemaRefreshWarning;
        didChange = true;
        return {
          ...node,
          data: restData,
        };
      });
      return didChange ? nextNodes : currentNodes;
    });
  }, [setNodes]);

  const refreshSwaggerTemplates = useCallback(
    async ({
      force = false,
      showSuccessToast = false,
    } = {}): Promise<SwaggerRefreshResult> => {
      // The refresh builds a workspace-scoped import URL. Never fire it while
      // WorkspaceContext is still loading — the URL would carry an empty
      // workspace segment (`/api/workspaces//workflows/...`) and fail as an
      // unroutable IPC request. The effect re-runs once the scope is ready.
      if (!isReady || !workspaceId) {
        return { skipped: true, reason: "workspace-not-ready" };
      }

      const selectedEnvId =
        selectedEnvironment && selectedEnvironment.trim()
          ? selectedEnvironment.trim()
          : null;
      const selectedEnvObject = selectedEnvId
        ? environments.find((env) => env.environmentId === selectedEnvId)
        : null;
      const swaggerDocUrl = selectedEnvObject?.swaggerDocUrl?.trim() || "";

      const signature = `${workflowId}::${selectedEnvId || ""}::${swaggerDocUrl}`;
      // Without a workflowId there is no safe shared key: every instance would
      // collide on one entry and skip refreshes for unrelated canvases, so
      // bypass the signature cache entirely in that case.
      if (workflowId) {
        if (
          !force &&
          swaggerAppliedSignatureByWorkflow.get(workflowId) === signature
        ) {
          return { skipped: true, reason: "unchanged-signature" };
        }
        rememberSwaggerSignature(workflowId, signature);
      }

      if (!selectedEnvId) {
        removeImportedGroup(envSwaggerGroupId);
        clearSwaggerWarningOnCanvas();
        if (showSuccessToast) {
          toast.error("Select an environment before refreshing Swagger.");
        }
        return { skipped: true, reason: "missing-environment" };
      }

      if (!swaggerDocUrl) {
        removeImportedGroup(envSwaggerGroupId);
        clearSwaggerWarningOnCanvas();
        if (showSuccessToast) {
          toast.error(
            `Environment "${selectedEnvObject?.name || "Selected"}" has no Swagger/OpenAPI URL.`,
          );
        }
        return { skipped: true, reason: "missing-swagger-url" };
      }

      if (!force && isSensitiveAutoRefreshTarget(swaggerDocUrl)) {
        return { skipped: true, reason: "loopback-requires-confirmation" };
      }

      const requestId = swaggerRefreshRequestIdRef.current + 1;
      swaggerRefreshRequestIdRef.current = requestId;
      setIsSwaggerRefreshing(true);

      try {
        const result = await fetchSwaggerNodes(
          workflowImportOpenapiRemoteUrl(workspaceId, swaggerDocUrl, true),
          swaggerCacheKey(workspaceId, swaggerDocUrl),
          force,
        );

        if (requestId !== swaggerRefreshRequestIdRef.current) {
          return { skipped: true, reason: "superseded" };
        }

        const apiNodes = result.nodes || [];
        const items: ImportedItem[] = apiNodes.map((node) => {
          const config = node.config || {};
          return {
            label: node.label || (config.url as string) || "Request",
            url: (config.url as string) || "",
            method: (config.method as string) || "GET",
            headers: (config.headers as string) || "",
            body: (config.body as string) || "",
            queryParams: (config.queryParams as string) || "",
            pathVariables: (config.pathVariables as string) || "",
            cookies: (config.cookies as string) || "",
            timeout: (config.timeout as number) || 30,
            openapiMeta: (config.openapiMeta as unknown) || null,
          };
        });

        addImportedGroup({
          title: `Swagger: ${selectedEnvObject?.name || "Environment"}`,
          id: envSwaggerGroupId,
          items,
        });

        const latestFingerprintSet = new Set<string>();
        const latestMethodPathSet = new Set<string>();
        const latestMethodsByPath = new Map<string, Set<string>>();
        const latestByOperationId = new Map<string, Record<string, unknown>>();

        apiNodes.forEach((apiNode) => {
          const meta = (apiNode.config as Record<string, unknown> | undefined)
            ?.openapiMeta as Record<string, unknown> | undefined;
          if (!meta || meta.source !== "openapi") return;

          const definitionScope = (
            (meta.definitionScope as string) || ""
          ).trim();
          const method = ((meta.method as string) || "").toUpperCase();
          const path = (meta.path as string) || "";
          const fingerprint = (meta.fingerprint as string) || "";
          const operationId = ((meta.operationId as string) || "").trim();

          if (fingerprint) latestFingerprintSet.add(fingerprint);
          if (method && path)
            latestMethodPathSet.add(`${definitionScope}|${method}|${path}`);

          if (path && method) {
            const pathScopeKey = `${definitionScope}|${path}`;
            if (!latestMethodsByPath.has(pathScopeKey)) {
              latestMethodsByPath.set(pathScopeKey, new Set());
            }
            latestMethodsByPath.get(pathScopeKey)!.add(method);
          }

          if (operationId) {
            latestByOperationId.set(`${definitionScope}|${operationId}`, meta);
          }
        });

        setNodes((currentNodes) => {
          let didChange = false;
          const nextNodes = currentNodes.map((node) => {
            if (node.type !== "http-request") {
              return node;
            }

            const existingWarning = node.data?.schemaRefreshWarning;
            const nodeMeta = node.data?.config?.openapiMeta as
              | Record<string, unknown>
              | undefined;

            if (!nodeMeta || nodeMeta.source !== "openapi") {
              if (!existingWarning) {
                return node;
              }
              didChange = true;
              const restData = { ...node.data! };
              delete restData.schemaRefreshWarning;
              return { ...node, data: restData };
            }

            const metaMethod = (
              (nodeMeta.method as string) || ""
            ).toUpperCase();
            const metaPath = (nodeMeta.path as string) || "";
            const metaFingerprint = (nodeMeta.fingerprint as string) || "";
            const metaScope = (
              (nodeMeta.definitionScope as string) || ""
            ).trim();
            const metaDefinitionName = (
              (nodeMeta.definitionName as string) || ""
            ).trim();
            const metaOperationId = (
              (nodeMeta.operationId as string) || ""
            ).trim();
            const methodPathKey =
              metaMethod && metaPath
                ? `${metaScope}|${metaMethod}|${metaPath}`
                : "";
            const operationScopeKey = metaOperationId
              ? `${metaScope}|${metaOperationId}`
              : "";
            const pathScopeKey = metaPath ? `${metaScope}|${metaPath}` : "";

            let warningText: string | null = null;

            if (metaFingerprint && latestFingerprintSet.has(metaFingerprint)) {
              warningText = null;
            } else if (
              methodPathKey &&
              latestMethodPathSet.has(methodPathKey)
            ) {
              warningText = null;
            } else if (
              operationScopeKey &&
              latestByOperationId.has(operationScopeKey)
            ) {
              const latestMeta = latestByOperationId.get(operationScopeKey)!;
              warningText = `Endpoint changed in Swagger docs (${metaMethod} ${metaPath} -> ${latestMeta.method} ${latestMeta.path}).`;
            } else if (pathScopeKey && latestMethodsByPath.has(pathScopeKey)) {
              const availableMethods = Array.from(
                latestMethodsByPath.get(pathScopeKey)!,
              ).join(", ");
              warningText = `Method mismatch for ${metaPath}. Available method(s): ${availableMethods}.`;
            } else {
              warningText = `Endpoint no longer found in Swagger docs (${metaMethod} ${metaPath}).`;
            }

            if (warningText && metaDefinitionName) {
              warningText = `[${metaDefinitionName}] ${warningText}`;
            }

            if (!warningText) {
              if (!existingWarning) {
                return node;
              }
              didChange = true;
              const restData = { ...node.data! };
              delete restData.schemaRefreshWarning;
              return {
                ...node,
                data: restData,
              };
            }

            const warningPayload = {
              text: warningText,
              sourceUrl: swaggerDocUrl,
              refreshedAt: new Date().toISOString(),
              endpointFingerprint: metaFingerprint || null,
            };

            if (
              existingWarning &&
              existingWarning.text === warningPayload.text &&
              existingWarning.sourceUrl === warningPayload.sourceUrl
            ) {
              return node;
            }

            didChange = true;
            return {
              ...node,
              data: {
                ...node.data,
                schemaRefreshWarning: warningPayload,
              },
            };
          });
          return didChange ? nextNodes : currentNodes;
        });

        if (showSuccessToast) {
          const summary = buildSwaggerRefreshSummary(
            result?.stats || {},
            items.length,
          );
          toast.success(summary.successMessage);

          if (summary.warningMessage) {
            toast.warning(summary.warningMessage);
          }
        }

        return { endpointCount: items.length };
      } catch (error) {
        if (requestId === swaggerRefreshRequestIdRef.current) {
          removeImportedGroup(envSwaggerGroupId);
        }
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Failed to refresh nodes from environment Swagger URL";
        toast.error(errorMessage);
        return { error: errorMessage };
      } finally {
        setIsSwaggerRefreshing(false);
      }
    },
    [
      workflowId,
      workspaceId,
      isReady,
      selectedEnvironment,
      environments,
      envSwaggerGroupId,
      addImportedGroup,
      removeImportedGroup,
      setNodes,
      clearSwaggerWarningOnCanvas,
    ],
  );

  const cancelSwaggerRefresh = useCallback(
    (requestId: number) => {
      if (swaggerRefreshRequestIdRef.current !== requestId) return;
      removeImportedGroup(envSwaggerGroupId);
    },
    [envSwaggerGroupId, removeImportedGroup],
  );

  useEffect(() => {
    const requestId = swaggerRefreshRequestIdRef.current + 1;
    swaggerRefreshRequestIdRef.current = requestId;
    return () => cancelSwaggerRefresh(requestId);
  }, [cancelSwaggerRefresh]);

  useEffect(() => {
    void refreshSwaggerTemplates();
  }, [refreshSwaggerTemplates]);

  const handleManualSwaggerRefresh = useCallback(() => {
    refreshSwaggerTemplates({ force: true, showSuccessToast: true });
  }, [refreshSwaggerTemplates]);

  return {
    isSwaggerRefreshing,
    handleManualSwaggerRefresh,
    refreshSwaggerTemplates,
  };
}
