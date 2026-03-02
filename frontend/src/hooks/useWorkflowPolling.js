import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import API_BASE_URL from '../utils/api';

function selectiveNodeUpdate(currentNodes, nodeStatuses) {
  return currentNodes.map((node) => {
    const nodeStatus = nodeStatuses[node.id];
    if (!nodeStatus) return node;

    const currentStatus = node.data?.executionStatus;
    const currentResult = node.data?.executionResult;

    if (currentStatus === nodeStatus.status && currentResult === nodeStatus.result) {
      return node;
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

export default function useWorkflowPolling({
  workflowId,
  nodes,
  setNodes,
  selectedEnvironment,
  environments,
  reactFlowInstanceRef,
}) {
  const [isRunning, setIsRunning] = useState(false);
  const [currentRunId, setCurrentRunId] = useState(null);
  const [showSecretsPrompt, setShowSecretsPrompt] = useState(false);
  const [isResumeLoading, setIsResumeLoading] = useState(false);
  const [resumeOptions, setResumeOptions] = useState([]);
  const [resumeSourceRunId, setResumeSourceRunId] = useState(null);
  const pollIntervalRef = useRef(null);
  const pendingRunRef = useRef(null);

  const refreshLatestFailedRun = useCallback(async () => {
    if (!workflowId) {
      setResumeOptions([]);
      setResumeSourceRunId(null);
      return { runId: null, failedNodes: [] };
    }

    setIsResumeLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}/runs/latest-failed`);
      if (!response.ok) {
        setResumeOptions([]);
        setResumeSourceRunId(null);
        return { runId: null, failedNodes: [] };
      }

      const data = await response.json();
      if (!data?.hasFailedRun) {
        setResumeOptions([]);
        setResumeSourceRunId(null);
        return { runId: null, failedNodes: [] };
      }

      const failedNodes = (data.failedNodes || []).map((node) => ({
        nodeId: node.nodeId,
        label: node.label || node.nodeId,
        type: node.type,
      }));

      setResumeSourceRunId(data.runId || null);
      setResumeOptions(failedNodes);
      return { runId: data.runId || null, failedNodes };
    } catch {
      setResumeOptions([]);
      setResumeSourceRunId(null);
      return { runId: null, failedNodes: [] };
    } finally {
      setIsResumeLoading(false);
    }
  }, [workflowId]);

  const executeRunWithSecrets = useCallback(async (runOptions = {}) => {
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

      const instance = reactFlowInstanceRef?.current;
      if (instance && invalidSummary[0]) {
        const firstId = invalidSummary[0].nodeId;
        const target = nodes.find((n) => n.id === firstId);
        if (target) {
          try {
            instance.setCenter(target.position.x, target.position.y, {
              zoom: 1.2,
            });
          } catch {
          }
        }
      }

      const details = invalidSummary
        .map((s) => `${s.nodeId}: ${s.missing.join(', ')}`)
        .join(' | ');

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

      const payload = {};
      if (Object.keys(runtimeSecrets).length > 0) {
        payload.secrets = runtimeSecrets;
      }
      if (runOptions.resume) {
        payload.resume = runOptions.resume;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: Object.keys(payload).length > 0 ? JSON.stringify(payload) : undefined,
      });

      if (response.ok) {
        const result = await response.json();
        setCurrentRunId(result.runId);
        setIsRunning(true);

        let pollAttempts = 0;
        const maxInitialAttempts = 20;

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
                refreshLatestFailedRun();
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
        let detail = `Failed to run workflow (${response.status})`;
        try {
          const body = await response.json();
          detail = body?.detail || detail;
        } catch {
        }
        toast.error(detail);
      }
    } catch (error) {
      console.error('Run error:', error);
      toast.error('Failed to trigger workflow run');
    }
  }, [
    workflowId,
    setNodes,
    selectedEnvironment,
    environments,
    nodes,
    reactFlowInstanceRef,
    refreshLatestFailedRun,
  ]);

  const ensureSecretsThenRun = useCallback((runOptions = {}) => {
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
          pendingRunRef.current = runOptions;
          setShowSecretsPrompt(true);
          return;
        }
      }
    }

    executeRunWithSecrets(runOptions);
  }, [workflowId, selectedEnvironment, environments, executeRunWithSecrets]);

  const runWorkflow = useCallback(async () => {
    ensureSecretsThenRun({});
  }, [ensureSecretsThenRun]);

  const runFromFailedNodes = useCallback((nodeIds, sourceRunId, mode = 'single') => {
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
      toast.error('No failed node is available to resume');
      return;
    }

    const resume = {
      mode,
      sourceRunId,
      startNodeIds: nodeIds,
    };

    if (mode === 'all-failed') {
      toast.info(`Running from ${nodeIds.length} failed node(s)`);
    } else {
      toast.info(`Running from failed node: ${nodeIds[0]}`);
    }

    ensureSecretsThenRun({ resume });
  }, [ensureSecretsThenRun]);

  const runFromLastFailed = useCallback(async () => {
    let options = resumeOptions;
    let sourceRunId = resumeSourceRunId;

    if (!sourceRunId || options.length === 0) {
      const latest = await refreshLatestFailedRun();
      options = latest.failedNodes;
      sourceRunId = latest.runId;
    }

    if (!sourceRunId || options.length === 0) {
      toast.error('No failed run available to resume');
      return;
    }

    runFromFailedNodes([options[0].nodeId], sourceRunId, 'single');
  }, [
    resumeOptions,
    resumeSourceRunId,
    refreshLatestFailedRun,
    runFromFailedNodes,
  ]);

  const runAllFailed = useCallback(() => {
    if (!resumeSourceRunId || resumeOptions.length === 0) {
      toast.error('No failed run available to resume');
      return;
    }

    runFromFailedNodes(
      resumeOptions.map((opt) => opt.nodeId),
      resumeSourceRunId,
      'all-failed',
    );
  }, [resumeSourceRunId, resumeOptions, runFromFailedNodes]);

  const handleSecretsProvided = useCallback(
    (_secrets) => {
      setShowSecretsPrompt(false);
      if (pendingRunRef.current) {
        const pending = pendingRunRef.current;
        pendingRunRef.current = null;
        executeRunWithSecrets(pending);
      }
    },
    [executeRunWithSecrets],
  );

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

  useEffect(() => {
    refreshLatestFailedRun();
  }, [refreshLatestFailedRun]);

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
    runFromLastFailed,
    runAllFailed,
    runFromFailedNodes,
    resumeOptions,
    resumeSourceRunId,
    isResumeLoading,
    refreshLatestFailedRun,
    showSecretsPrompt,
    setShowSecretsPrompt,
    pendingRunRef,
    handleSecretsProvided,
    loadHistoricalRun,
  };
}
