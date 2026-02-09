import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import API_BASE_URL from '../utils/api';

/**
 * Selective node update — only patches nodes whose execution status changed.
 * Prevents unnecessary React rerenders by preserving object identity for
 * nodes whose status hasn't changed.
 */
function selectiveNodeUpdate(currentNodes, nodeStatuses) {
  return currentNodes.map((node) => {
    const nodeStatus = nodeStatuses[node.id];
    if (!nodeStatus) return node;

    const currentStatus = node.data?.executionStatus;
    const currentResult = node.data?.executionResult;

    if (currentStatus === nodeStatus.status && currentResult === nodeStatus.result) {
      return node; // no change — keep same reference
    }

    const result = nodeStatus.result;
    return {
      ...node,
      data: {
        ...node.data,
        executionStatus: nodeStatus.status,
        executionResult: result,
        executionTimestamp: Date.now(),
      },
    };
  });
}

/**
 * useWorkflowPolling — workflow run + adaptive polling hook.
 *
 * Extracted from WorkflowCanvas to reduce complexity.
 * Handles: run trigger, secret checking, pre-run validation,
 * adaptive status polling (100 ms fast → 1 s slow), and
 * loading historical runs.
 *
 * @param {Object} params
 * @param {string}   params.workflowId
 * @param {Array}    params.nodes
 * @param {Function} params.setNodes
 * @param {string}   params.selectedEnvironment
 * @param {Array}    params.environments
 * @param {Object}   params.reactFlowInstance
 * @returns {Object}
 */
export default function useWorkflowPolling({
  workflowId,
  nodes,
  setNodes,
  selectedEnvironment,
  environments,
  reactFlowInstance,
}) {
  const [isRunning, setIsRunning] = useState(false);
  const [currentRunId, setCurrentRunId] = useState(null);
  const [showSecretsPrompt, setShowSecretsPrompt] = useState(false);
  const pollIntervalRef = useRef(null);
  const pendingRunRef = useRef(false);

  // ---- Gather runtime secrets and fire the run ----
  const executeRunWithSecrets = useCallback(async () => {
    const envId =
      selectedEnvironment && selectedEnvironment.trim()
        ? selectedEnvironment.trim()
        : null;

    let runtimeSecrets = {};
    if (envId) {
      const selectedEnv = environments.find(
        (e) => e.environmentId === envId,
      );
      const envSecrets = selectedEnv?.secrets || {};
      Object.keys(envSecrets).forEach((key) => {
        const val = sessionStorage.getItem(`secret_${key}`);
        if (val) runtimeSecrets[key] = val;
      });
    }

    // Pre-run validation: assertion nodes must have valid configs
    const invalidSummary = [];
    nodes.forEach((n) => {
      if (n.type === 'assertion') {
        const assertions = n.data?.config?.assertions || [];
        const missing = [];
        assertions.forEach((a, idx) => {
          if (a.source === 'status') return;
          if (['exists', 'notExists'].includes(a.operator)) {
            if (!a.path || !a.path.trim())
              missing.push(`assertion[${idx}].path`);
          } else {
            if (!a.path || !a.path.trim())
              missing.push(`assertion[${idx}].path`);
            if (!a.expectedValue || !String(a.expectedValue).trim())
              missing.push(`assertion[${idx}].expectedValue`);
          }
        });
        if (missing.length > 0) {
          invalidSummary.push({ nodeId: n.id, missing });
        }
      }
    });

    if (invalidSummary.length > 0) {
      const invalidIds = new Set(invalidSummary.map((s) => s.nodeId));
      setNodes((nds) =>
        nds.map((node) =>
          invalidIds.has(node.id)
            ? { ...node, data: { ...node.data, invalid: true } }
            : node,
        ),
      );

      if (reactFlowInstance && invalidSummary[0]) {
        const firstId = invalidSummary[0].nodeId;
        const target = nodes.find((n) => n.id === firstId);
        if (target) {
          try {
            reactFlowInstance.setCenter(target.position.x, target.position.y, {
              zoom: 1.2,
            });
          } catch {
            /* ignore */
          }
        }
      }

      const details = invalidSummary
        .map((s) => `${s.nodeId}: ${s.missing.join(', ')}`)
        .join(' | ');

      // Import toast lazily — keeps the hook standalone
      toast.error(`Run blocked: invalid node config — ${details}`, {
        duration: 8000,
      });

      setTimeout(() => {
        setNodes((nds) =>
          nds.map((node) =>
            node.data && node.data.invalid
              ? { ...node, data: { ...node.data, invalid: false } }
              : node,
          ),
        );
      }, 6000);

      return;
    }

    try {
      // Clear old execution status
      setNodes((nds) =>
        nds.map((node) => ({
          ...node,
          data: {
            ...node.data,
            executionStatus: undefined,
            executionResult: undefined,
            executionTimestamp: undefined,
          },
        })),
      );

      const runEnvId =
        selectedEnvironment && selectedEnvironment.trim()
          ? selectedEnvironment.trim()
          : null;

      const url = runEnvId
        ? `${API_BASE_URL}/api/workflows/${workflowId}/run?environmentId=${runEnvId}`
        : `${API_BASE_URL}/api/workflows/${workflowId}/run`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:
          Object.keys(runtimeSecrets).length > 0
            ? JSON.stringify({ secrets: runtimeSecrets })
            : undefined,
      });

      if (response.ok) {
        const result = await response.json();
        setCurrentRunId(result.runId);
        setIsRunning(true);

        // Adaptive polling: fast (100 ms) → slow (1 s)
        let pollAttempts = 0;
        const maxInitialAttempts = 20; // 2 seconds of fast polling

        const pollForStatus = async () => {
          try {
            const statusResponse = await fetch(
              `${API_BASE_URL}/api/workflows/${workflowId}/runs/${result.runId}`,
            );
            if (statusResponse.ok) {
              const runData = await statusResponse.json();

              if (runData.nodeStatuses) {
                setNodes((nds) =>
                  selectiveNodeUpdate(nds, runData.nodeStatuses),
                );
              }

              if (
                runData.status === 'completed' ||
                runData.status === 'failed'
              ) {
                clearInterval(pollIntervalRef.current);
                setIsRunning(false);
              }
            }
          } catch (error) {
            console.error('Status poll error:', error);
          }
        };

        const fastPollInterval = setInterval(() => {
          pollForStatus();
          pollAttempts++;
          if (pollAttempts >= maxInitialAttempts) {
            clearInterval(fastPollInterval);
            pollIntervalRef.current = setInterval(pollForStatus, 1000);
          }
        }, 100);

        pollIntervalRef.current = fastPollInterval;
      } else {
        const error = await response.text();
        console.error(`Failed to run workflow: ${error}`);
      }
    } catch (error) {
      console.error('Run error:', error);
    }
  }, [
    workflowId,
    setNodes,
    selectedEnvironment,
    environments,
    nodes,
    reactFlowInstance,
  ]);

  // ---- Public: check secrets first, then run ----
  const runWorkflow = useCallback(async () => {
    if (!workflowId) {
      console.warn('Please save the workflow first');
      return;
    }

    const envId =
      selectedEnvironment && selectedEnvironment.trim()
        ? selectedEnvironment.trim()
        : null;

    if (envId) {
      const selectedEnv = environments.find(
        (e) => e.environmentId === envId,
      );
      const envSecrets = selectedEnv?.secrets || {};
      const secretKeys = Object.keys(envSecrets);

      if (secretKeys.length > 0) {
        const missingSecrets = secretKeys.filter(
          (k) => !sessionStorage.getItem(`secret_${k}`)?.trim(),
        );
        if (missingSecrets.length > 0) {
          pendingRunRef.current = true;
          setShowSecretsPrompt(true);
          return;
        }
      }
    }

    executeRunWithSecrets();
  }, [workflowId, selectedEnvironment, environments, executeRunWithSecrets]);

  // ---- Handle secrets provided from SecretsPrompt ----
  const handleSecretsProvided = useCallback(
    (_secrets) => {
      setShowSecretsPrompt(false);
      if (pendingRunRef.current) {
        pendingRunRef.current = false;
        executeRunWithSecrets();
      }
    },
    [executeRunWithSecrets],
  );

  // ---- Load a historical run and apply its node statuses ----
  const loadHistoricalRun = useCallback(
    async (run) => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/workflows/${workflowId}/runs/${run.runId}`,
        );
        if (response.ok) {
          const fullRunData = await response.json();
          if (fullRunData.nodeStatuses) {
            setNodes((nds) =>
              selectiveNodeUpdate(nds, fullRunData.nodeStatuses),
            );
          }
          setCurrentRunId(fullRunData.runId);
        } else {
          console.error('Failed to load run details');
        }
      } catch (error) {
        console.error('Error loading run details:', error);
      }
    },
    [workflowId, setNodes],
  );

  // ---- Cleanup polling on unmount ----
  useEffect(
    () => () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    },
    [],
  );

  return {
    isRunning,
    currentRunId,
    runWorkflow,
    showSecretsPrompt,
    setShowSecretsPrompt,
    pendingRunRef,
    handleSecretsProvided,
    loadHistoricalRun,
  };
}
