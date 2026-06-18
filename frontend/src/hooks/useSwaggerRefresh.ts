import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { usePalette } from '../contexts/PaletteContext';
import { authenticatedFetch } from '../utils/authenticatedApi';
import { buildSwaggerRefreshSummary } from '../utils/swaggerRefreshSummary';
import { useScopeContext } from '../hooks/useScopeContext';
import { workflowImportOpenapiRemoteUrl } from '../utils/scopedApi';
import type { Node } from 'reactflow';
import type { WorkflowCanvasNodeData } from '../types/WorkflowCanvasNodeData';
import type { EnvironmentWithSwagger } from '../types/EnvironmentWithSwagger';
import type { ImportedItem } from '../types/ImportedItem';
import type { SwaggerRefreshResult } from '../types/SwaggerRefreshResult';

interface UseSwaggerRefreshParams {
  workflowId: string | undefined;
  selectedEnvironment: string | null;
  environments: EnvironmentWithSwagger[];
  setNodes: React.Dispatch<React.SetStateAction<Node<WorkflowCanvasNodeData>[]>>;
}

export function useSwaggerRefresh({
  workflowId,
  selectedEnvironment,
  environments,
  setNodes,
}: UseSwaggerRefreshParams) {
  const { addImportedGroup, removeImportedGroup } = usePalette();
  const { workspaceId } = useScopeContext();
  const [isSwaggerRefreshing, setIsSwaggerRefreshing] = useState(false);
  const swaggerRefreshSignatureRef = useRef('');
  const swaggerRefreshRequestIdRef = useRef(0);
  const envSwaggerGroupId = `env-openapi-${workflowId}`;

  const clearSwaggerWarningOnCanvas = useCallback(() => {
    setNodes((currentNodes) => {
      let didChange = false;
      const nextNodes = currentNodes.map((node) => {
        if (node.type !== 'http-request' || !node.data?.schemaRefreshWarning) {
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

  const refreshSwaggerTemplates = useCallback(async ({ force = false, showSuccessToast = false } = {}): Promise<SwaggerRefreshResult> => {
    const selectedEnvId = selectedEnvironment && selectedEnvironment.trim()
      ? selectedEnvironment.trim()
      : null;
    const selectedEnvObject = selectedEnvId
      ? environments.find((env) => env.environmentId === selectedEnvId)
      : null;
    const swaggerDocUrl = selectedEnvObject?.swaggerDocUrl?.trim() || '';

    const signature = `${workflowId}::${selectedEnvId || ''}::${swaggerDocUrl}`;
    if (!force && swaggerRefreshSignatureRef.current === signature) {
      return { skipped: true, reason: 'unchanged-signature' };
    }
    swaggerRefreshSignatureRef.current = signature;

    if (!selectedEnvId) {
      removeImportedGroup(envSwaggerGroupId);
      clearSwaggerWarningOnCanvas();
      if (showSuccessToast) {
        toast.error('Select an environment before refreshing Swagger.');
      }
      return { skipped: true, reason: 'missing-environment' };
    }

    if (!swaggerDocUrl) {
      removeImportedGroup(envSwaggerGroupId);
      clearSwaggerWarningOnCanvas();
      if (showSuccessToast) {
        toast.error(`Environment "${selectedEnvObject?.name || 'Selected'}" has no Swagger/OpenAPI URL.`);
      }
      return { skipped: true, reason: 'missing-swagger-url' };
    }

    const requestId = swaggerRefreshRequestIdRef.current + 1;
    swaggerRefreshRequestIdRef.current = requestId;
    setIsSwaggerRefreshing(true);

    try {
      const response = await authenticatedFetch(
        workflowImportOpenapiRemoteUrl(workspaceId || '', swaggerDocUrl, true)
      );

      if (!response.ok) {
        let detail = 'Failed to load Swagger/OpenAPI URL';
        try {
          const errorBody = await response.json() as { detail?: string };
          detail = errorBody.detail || detail;
        } catch {
          // Keep default error detail if response body is not JSON
        }
        throw new Error(detail);
      }

      if (requestId !== swaggerRefreshRequestIdRef.current) {
        return { skipped: true, reason: 'superseded' };
      }

      const result = await response.json() as { nodes?: Array<{ label?: string; config?: Record<string, unknown> }>; stats?: Record<string, unknown> };

      const apiNodes = result.nodes || [];
      const items: ImportedItem[] = apiNodes.map((node) => {
        const config = node.config || {};
        return {
          label: node.label || (config.url as string) || 'Request',
          url: (config.url as string) || '',
          method: (config.method as string) || 'GET',
          headers: (config.headers as string) || '',
          body: (config.body as string) || '',
          queryParams: (config.queryParams as string) || '',
          pathVariables: (config.pathVariables as string) || '',
          cookies: (config.cookies as string) || '',
          timeout: (config.timeout as number) || 30,
          openapiMeta: (config.openapiMeta as unknown) || null,
        };
      });

      addImportedGroup({
        title: `Swagger: ${selectedEnvObject?.name || 'Environment'}`,
        id: envSwaggerGroupId,
        items,
      });

      const latestFingerprintSet = new Set<string>();
      const latestMethodPathSet = new Set<string>();
      const latestMethodsByPath = new Map<string, Set<string>>();
      const latestByOperationId = new Map<string, Record<string, unknown>>();

      apiNodes.forEach((apiNode) => {
        const meta = (apiNode.config as Record<string, unknown> | undefined)?.openapiMeta as Record<string, unknown> | undefined;
        if (!meta || meta.source !== 'openapi') return;

        const definitionScope = ((meta.definitionScope as string) || '').trim();
        const method = ((meta.method as string) || '').toUpperCase();
        const path = (meta.path as string) || '';
        const fingerprint = (meta.fingerprint as string) || '';
        const operationId = ((meta.operationId as string) || '').trim();

        if (fingerprint) latestFingerprintSet.add(fingerprint);
        if (method && path) latestMethodPathSet.add(`${definitionScope}|${method}|${path}`);

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
          if (node.type !== 'http-request') {
            return node;
          }

          const existingWarning = node.data?.schemaRefreshWarning;
          const nodeMeta = node.data?.config?.openapiMeta as Record<string, unknown> | undefined;

          if (!nodeMeta || nodeMeta.source !== 'openapi') {
            if (!existingWarning) {
              return node;
            }
            didChange = true;
            const restData = { ...node.data! };
            delete restData.schemaRefreshWarning;
            return { ...node, data: restData };
          }

          const metaMethod = ((nodeMeta.method as string) || '').toUpperCase();
          const metaPath = (nodeMeta.path as string) || '';
          const metaFingerprint = (nodeMeta.fingerprint as string) || '';
          const metaScope = ((nodeMeta.definitionScope as string) || '').trim();
          const metaDefinitionName = ((nodeMeta.definitionName as string) || '').trim();
          const metaOperationId = ((nodeMeta.operationId as string) || '').trim();
          const methodPathKey = metaMethod && metaPath ? `${metaScope}|${metaMethod}|${metaPath}` : '';
          const operationScopeKey = metaOperationId ? `${metaScope}|${metaOperationId}` : '';
          const pathScopeKey = metaPath ? `${metaScope}|${metaPath}` : '';

          let warningText: string | null = null;

          if (metaFingerprint && latestFingerprintSet.has(metaFingerprint)) {
            warningText = null;
          } else if (methodPathKey && latestMethodPathSet.has(methodPathKey)) {
            warningText = null;
          } else if (operationScopeKey && latestByOperationId.has(operationScopeKey)) {
            const latestMeta = latestByOperationId.get(operationScopeKey)!;
            warningText = `Endpoint changed in Swagger docs (${metaMethod} ${metaPath} -> ${latestMeta.method} ${latestMeta.path}).`;
          } else if (pathScopeKey && latestMethodsByPath.has(pathScopeKey)) {
            const availableMethods = Array.from(latestMethodsByPath.get(pathScopeKey)!).join(', ');
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
        const summary = buildSwaggerRefreshSummary(result?.stats || {}, items.length);
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
      const errorMessage = error instanceof Error ? error.message : 'Failed to refresh nodes from environment Swagger URL';
      toast.error(errorMessage);
      return { error: errorMessage };
    } finally {
      if (requestId === swaggerRefreshRequestIdRef.current) {
        setIsSwaggerRefreshing(false);
      }
    }
  }, [
    workflowId,
    workspaceId,
    selectedEnvironment,
    environments,
    envSwaggerGroupId,
    addImportedGroup,
    removeImportedGroup,
    setNodes,
    clearSwaggerWarningOnCanvas,
  ]);

  const cancelSwaggerRefresh = useCallback((requestId: number) => {
    if (swaggerRefreshRequestIdRef.current !== requestId) return;
    removeImportedGroup(envSwaggerGroupId);
  }, [envSwaggerGroupId, removeImportedGroup]);

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