import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  type MutableRefObject,
} from "react";
import { toast } from "sonner";
import type { Node } from "reactflow";
import { apiweave, onRunProgress, IpcError } from "../utils/apiweaveClient";
import type { RunProgressEvent } from "@shared/types/RunProgressEvent";
import useRunChoreography from "./useRunChoreography";
import type { PacedEvent } from "../utils/runChoreography";
import type { RunResult } from "../types/RunResult";

/** The canvas renders nodes by `executionStatus` in {running, success, error,
 * warning, skipped} (see `BaseNode`'s statusConfig). Normalise both vocabularies
 * onto that: the runner stream speaks passed/failed, historical `runs.get`
 * results speak success/error — everything else, `skipped` included, passes
 * through unchanged and is rendered as itself. */
function canvasStatus(status: string): string {
  if (status === "passed") return "success";
  if (status === "failed") return "error";
  return status;
}

interface NodeStatusUpdate {
  status: string;
  result?: unknown;
}

interface NodeStatuses {
  [nodeId: string]: NodeStatusUpdate;
}

// ponytail: closed whitelist (error/message/statusCode only) — intentional tiny failure summary for the streamed node.completed event. If the runner starts emitting more fields here, expand this; live-finish path uses resultFromRunResult (full data).
function resultFromStatusEntry(entry: unknown): unknown | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const data = entry as Record<string, unknown>;
  const error = typeof data.error === "string" ? data.error : undefined;
  const message = typeof data.message === "string" ? data.message : undefined;
  const statusCode =
    typeof data.statusCode === "number" ? data.statusCode : undefined;
  if (!error && !message && statusCode === undefined) return undefined;

  return {
    ...(error ? { error } : {}),
    ...(message ? { message } : {}),
    ...(statusCode !== undefined ? { statusCode } : {}),
  };
}

function resultFromRunResult(result: unknown): unknown {
  if (typeof result !== "object" || result === null) return result;
  const data = result as Record<string, unknown>;
  const response =
    typeof data.response === "object" && data.response !== null
      ? (data.response as Record<string, unknown>)
      : undefined;
  const statusCode =
    typeof response?.statusCode === "number"
      ? response.statusCode
      : typeof response?.status === "number"
        ? response.status
        : undefined;

  return {
    ...data,
    ...(response ?? {}),
    ...(statusCode !== undefined ? { statusCode } : {}),
  };
}

/** Paint a finished run's per-node results onto `statuses`, in place. Shared by
 * the live-finish hydration path and by opening a historical run — both read
 * the same `Run.results` shape and attach `resolvedSecrets` the same way. */
function applyRunResults(
  statuses: NodeStatuses,
  results: readonly RunResult[],
  resolvedSecrets:
    | readonly {
        readonly name: string;
        readonly scopeType: "environment" | "workspace" | null;
        readonly resolved: boolean;
      }[]
    | undefined,
): void {
  for (const result of results) {
    statuses[result.nodeId] = {
      status: result.status,
      result: {
        ...(resultFromRunResult(result) as Record<string, unknown>),
        ...(resolvedSecrets && resolvedSecrets.length > 0
          ? { resolvedSecrets }
          : {}),
      },
    };
  }
}

/** Read a finished run's per-node statuses into `statuses`, in place.
 *
 * `nodeStatuses` is the wider of the two records a run carries: every node the
 * runner touched appears in it, including the ones that execute nothing and so
 * never produce a `RunResult` — `start` and `end`. Reading only `results` is
 * what used to leave the terminal nodes grey on a run that plainly reached
 * them. `applyRunResults` runs after this and overwrites with the detail. */
function applyRunNodeStatuses(
  statuses: NodeStatuses,
  nodeStatuses: Readonly<Record<string, unknown>> | undefined,
): void {
  for (const [nodeId, entry] of Object.entries(nodeStatuses ?? {})) {
    if (typeof entry === "string") {
      statuses[nodeId] = { status: entry };
      continue;
    }
    if (typeof entry === "object" && entry !== null) {
      const status = (entry as Record<string, unknown>).status;
      if (typeof status === "string") {
        statuses[nodeId] = { status, result: resultFromStatusEntry(entry) };
      }
    }
  }
}

function selectiveNodeUpdate(
  currentNodes: Node[],
  nodeStatuses: NodeStatuses,
): Node[] {
  return currentNodes.map((node) => {
    const update = nodeStatuses[node.id];
    if (!update) return node;

    const mapped = canvasStatus(update.status);
    const data = node.data as Record<string, unknown>;
    if (
      data?.executionStatus === mapped &&
      (update.result === undefined || data?.executionResult === update.result)
    ) {
      return node;
    }

    return {
      ...node,
      data: {
        ...data,
        executionStatus: mapped,
        ...(update.result !== undefined
          ? { executionResult: update.result }
          : {}),
        executionTimestamp: Date.now(),
      },
    };
  });
}

interface FailedNodeOption {
  nodeId: string;
  label: string;
  type: string;
}

interface RunOptions {
  resume?: {
    mode: string;
    sourceRunId: string | null;
    startNodeIds: string[];
  };
}

interface UseWorkflowPollingParams {
  workspaceId: string | null;
  workflowId: string | undefined;
  nodes: Node[];
  // Topology only, for the playback: which node's traversal has to land before
  // the next one is allowed to light up. Never read for anything else.
  edges: readonly { source: string; target: string }[];
  setNodes: (updater: (nds: Node[]) => Node[]) => void;
  selectedEnvironment: string | null | undefined;
  reactFlowInstanceRef: MutableRefObject<{
    setCenter: (x: number, y: number, opts: { zoom: number }) => void;
  } | null> | null;
  // Latest canvas-save fn, kept in a ref because it's defined after this hook
  // is called in WorkflowCanvas. Awaited before a run so the scheduler loads
  // the current graph, not a copy stale by up to one autosave debounce.
  saveWorkflowRef?: MutableRefObject<
    ((silent: boolean) => Promise<void>) | null
  > | null;
}

interface UseWorkflowPollingResult {
  isRunning: boolean;
  currentRunId: string | null;
  runWorkflow: () => Promise<void>;
  cancelRun: () => Promise<void>;
  runFromLastFailed: () => Promise<void>;
  runAllFailed: () => void;
  runFromFailedNodes: (
    nodeIds: string[],
    sourceRunId: string,
    mode?: string,
  ) => void;
  resumeOptions: FailedNodeOption[];
  resumeSourceRunId: string | null;
  isResumeLoading: boolean;
  refreshLatestFailedRun: () => Promise<{
    runId: string | null;
    failedNodes: FailedNodeOption[];
  }>;
  loadHistoricalRun: (run: { runId: string }) => Promise<void>;
}

/**
 * Drives a workflow run and streams its progress into the canvas over the
 * per-run IPC topic (`onRunProgress`) — no HTTP, no `setInterval` polling.
 * Each `node.completed` event repaints one node; the terminal `run.finished`
 * event stops the stream and hydrates per-node results from a single
 * `runs.get`. (Task 20; replaces the old adaptive-poll loop.)
 */
export default function useWorkflowPolling({
  workspaceId,
  workflowId,
  nodes,
  edges,
  setNodes,
  selectedEnvironment,
  reactFlowInstanceRef,
  saveWorkflowRef,
}: UseWorkflowPollingParams): UseWorkflowPollingResult {
  const [isRunning, setIsRunning] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [isResumeLoading, setIsResumeLoading] = useState(false);
  const [latestFailedRun, setLatestFailedRun] = useState<{
    runId: string | null;
    failedNodes: FailedNodeOption[];
  } | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const currentRunIdRef = useRef<string | null>(null);
  // Synchronous guard against double-enqueue from rapid clicks/triggers: set
  // before awaiting runs.create, released once the run has started (or failed).
  const isStartingRef = useRef(false);
  // The runner is done but the playback may not be. Distinguishes "cancel the
  // run" from "skip the rest of the animation" — see `cancelRun`.
  const runFinishedRef = useRef(false);
  const latestFailedRunRef = useRef<{
    runId: string | null;
    failedNodes: FailedNodeOption[];
  } | null>(null);
  /**
   * The nodes this canvas released itself when the run started — see
   * `executeWorkflow`. Held so the stream's own copy of the same fact, if it
   * ever does arrive, is recognised as a duplicate rather than replayed.
   */
  const entryNodeIdsRef = useRef<ReadonlySet<string>>(new Set());

  const resumeOptions = useMemo(
    () => latestFailedRun?.failedNodes ?? [],
    [latestFailedRun],
  );
  const resumeSourceRunId = useMemo(
    () => latestFailedRun?.runId ?? null,
    [latestFailedRun],
  );

  const stopStream = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
  }, []);

  const refreshLatestFailedRun = useCallback(async () => {
    if (!workspaceId || !workflowId) {
      latestFailedRunRef.current = null;
      setLatestFailedRun(null);
      return { runId: null, failedNodes: [] };
    }

    setIsResumeLoading(true);
    try {
      const run = await apiweave.runs.getLatestFailed(workspaceId, workflowId);
      if (!run) {
        latestFailedRunRef.current = null;
        setLatestFailedRun(null);
        return { runId: null, failedNodes: [] };
      }

      const failedNodes = (run.failedNodes ?? []).map((nodeId) => ({
        nodeId,
        label: nodeId,
        type: "unknown",
      }));

      const nextLatest = { runId: run.runId, failedNodes };
      latestFailedRunRef.current = nextLatest;
      setLatestFailedRun(nextLatest);
      return { runId: run.runId, failedNodes };
    } catch {
      latestFailedRunRef.current = null;
      setLatestFailedRun(null);
      return { runId: null, failedNodes: [] };
    } finally {
      setIsResumeLoading(false);
    }
  }, [workspaceId, workflowId]);

  /** Pull the finished run once and paint per-node request/response detail that
   * the lightweight event stream intentionally omits. */
  const hydrateRunResults = useCallback(
    async (runId: string) => {
      if (!workspaceId) return;
      try {
        const run = await apiweave.runs.get(workspaceId, runId);
        // A second run can start while this one is still in flight — the
        // playback deliberately trails the run, so the gap is wide enough to
        // click Run again inside it. Landing these results on the next run's
        // canvas would repaint it with the previous run's answers.
        if (currentRunIdRef.current !== runId) return;
        const resolvedSecrets = run.resolvedSecrets;
        const statuses: NodeStatuses = {};
        applyRunNodeStatuses(statuses, run.nodeStatuses);
        applyRunResults(statuses, run.results ?? [], resolvedSecrets);
        setNodes((nds) => selectiveNodeUpdate(nds, statuses));
      } catch {
        // ignore — the canvas keeps the streamed statuses
      }
    },
    [workspaceId, setNodes],
  );

  /** One node repaint, on the playback's schedule rather than the runner's. */
  const releaseNodeStatus = useCallback(
    (event: PacedEvent) => {
      setNodes((nds) =>
        selectiveNodeUpdate(nds, {
          [event.nodeId]: {
            status: event.status,
            ...(event.result !== undefined ? { result: event.result } : {}),
          },
        }),
      );
    },
    [setNodes],
  );

  const choreography = useRunChoreography({
    edges,
    release: releaseNodeStatus,
  });

  const handleEvent = useCallback(
    (event: RunProgressEvent) => {
      if (event.kind === "node.status") {
        // The entry point was released locally when the run started, because
        // its real event predates this subscription. On a machine where it does
        // land, it is that same fact arriving late; releasing it a second time
        // would restart the clock on the traversals leaving Start.
        if (entryNodeIdsRef.current.has(event.nodeId)) return;
        // Queued, not applied. The runner reports a 200ms node as running and
        // done inside one frame; the canvas spaces those out so the edge
        // leading into it has somewhere to happen.
        choreography.enqueue({
          nodeId: event.nodeId,
          status: canvasStatus(event.status),
          result: resultFromStatusEntry(event),
        });
        return;
      }
      if (event.kind === "run.started") return; // canvas already reset on enqueue
      // run.finished
      stopStream();
      runFinishedRef.current = true;
      // `isRunning` and the hydration both wait for the playback. The toolbar
      // saying "Run" while the canvas is still narrating is the same defect as
      // the edges being out of step with the nodes, one level up; and hydration
      // repaints every node at once, which would overtake the traversals still
      // in flight.
      const runId = event.runId;
      choreography.whenSettled(() => {
        setIsRunning(false);
        void hydrateRunResults(runId);
      });
      void refreshLatestFailedRun();
    },
    [choreography, stopStream, hydrateRunResults, refreshLatestFailedRun],
  );

  const executeWorkflow = useCallback(
    async (_runOptions: RunOptions = {}) => {
      if (!workspaceId || !workflowId) return;

      const invalidSummary: { nodeId: string; missing: string[] }[] = [];
      nodes.forEach((n) => {
        if (n.type === "assertion") {
          const assertions = (
            (n.data as Record<string, unknown>)?.config as
              | Record<string, unknown>
              | undefined
          )?.assertions as
            | {
                source?: string;
                operator?: string;
                path?: string;
                expectedValue?: string;
              }[]
            | undefined;
          const assertionList = assertions ?? [];
          const missing: string[] = [];
          assertionList.forEach((a, idx) => {
            if (a.source === "status") return;
            if (["exists", "notExists"].includes(a.operator ?? "")) {
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
              ? {
                  ...node,
                  data: {
                    ...(node.data as Record<string, unknown>),
                    invalid: true,
                  },
                }
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
              // ignore
            }
          }
        }

        const details = invalidSummary
          .map((s) => `${s.nodeId}: ${s.missing.join(", ")}`)
          .join(" | ");

        toast.error(`Run blocked: invalid node config — ${details}`, {
          duration: 8000,
        });

        setTimeout(() => {
          setNodes((nds) =>
            nds.map((node) =>
              (node.data as Record<string, unknown> | undefined)?.invalid
                ? {
                    ...node,
                    data: {
                      ...(node.data as Record<string, unknown>),
                      invalid: false,
                    },
                  }
                : node,
            ),
          );
        }, 6000);

        return;
      }

      if (isStartingRef.current) return;
      isStartingRef.current = true;

      try {
        stopStream();
        // Anything the previous run's playback had not finished telling is not
        // context for this one.
        choreography.reset();
        runFinishedRef.current = false;
        // Recomputed per run, and before the subscription exists, so the filter
        // in `handleEvent` is already in place for the first event that lands.
        entryNodeIdsRef.current = new Set(
          nodes.filter((node) => node.type === "start").map((node) => node.id),
        );
        setNodes((nds) =>
          nds.map((node) => ({
            ...node,
            data: {
              ...(node.data as Record<string, unknown>),
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

        // Flush pending canvas edits before the run. The scheduler loads the
        // graph from persisted storage by workflowId, so without this a click
        // less than one autosave debounce (700ms) after an edit would execute
        // the stale graph against external systems.
        await saveWorkflowRef?.current?.(false);

        // ponytail: resume (run-from-failed) is not forwarded — `runs.create`'s
        // input schema is .strict() and the scheduler's resume path isn't wired
        // yet, so this triggers a full run. Restore once the composition-root
        // enqueue handler + resume plumbing land (deferred Task 13/21 wiring).
        const run = await apiweave.runs.create({
          workspaceId,
          workflowId,
          ...(runEnvId ? { selectedEnvironmentId: runEnvId } : {}),
        });

        setCurrentRunId(run.runId);
        currentRunIdRef.current = run.runId;
        setIsRunning(true);
        unsubscribeRef.current = onRunProgress(run.runId, handleEvent);

        // The entry point's result is the one event this subscription can never
        // receive. The progress channel is keyed by runId, so it cannot be
        // opened until `runs.create` has replied — and the runner, which starts
        // the run inside that same call, has already stamped the start node as
        // passed by the time the reply crosses back. Its status therefore only
        // arrived with the end-of-run hydration, which left every edge out of
        // Start grey for the whole run while the rest of the canvas lit up.
        //
        // Nothing has to be told to the canvas here: a run beginning *is* the
        // entry point passing, and this side knows the moment it began. The
        // node goes through the same playback as any other, so the traversal
        // out of Start is drawn rather than snapped.
        for (const nodeId of entryNodeIdsRef.current) {
          choreography.enqueue({ nodeId, status: "success" });
        }
      } catch (error) {
        const detail =
          error instanceof IpcError
            ? error.message
            : "Failed to trigger workflow run";
        toast.error(detail);
      } finally {
        isStartingRef.current = false;
      }
    },
    [
      workspaceId,
      workflowId,
      setNodes,
      selectedEnvironment,
      nodes,
      reactFlowInstanceRef,
      stopStream,
      handleEvent,
      choreography,
    ],
  );

  const runWorkflow = useCallback(async () => {
    if (!workspaceId || !workflowId) return;
    executeWorkflow({});
  }, [workspaceId, workflowId, executeWorkflow]);

  const cancelRun = useCallback(async () => {
    // The runner already finished and what is left on screen is the playback
    // catching up. Cancel here means "skip the rest", not "stop the run":
    // there is nothing left to stop, and asking the scheduler to cancel a
    // finished run only earns an error toast.
    if (runFinishedRef.current) {
      choreography.flush();
      return;
    }

    const runId = currentRunIdRef.current;
    if (!workspaceId || !runId) return;
    try {
      await apiweave.runs.cancel(workspaceId, runId);
      // The scheduler emits run.finished on cancel, which stops the stream.
    } catch (error) {
      const detail =
        error instanceof IpcError ? error.message : "Failed to cancel run";
      toast.error(detail);
    }
  }, [workspaceId, choreography]);

  const runFromFailedNodes = useCallback(
    (nodeIds: string[], sourceRunId: string, mode = "single") => {
      if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
        toast.error("No failed node is available to resume");
        return;
      }

      const resume = {
        mode,
        sourceRunId,
        startNodeIds: nodeIds,
      };

      if (mode === "all-failed") {
        toast.info(`Running from ${nodeIds.length} failed node(s)`);
      } else {
        toast.info(`Running from failed node: ${nodeIds[0] ?? ""}`);
      }

      executeWorkflow({ resume });
    },
    [executeWorkflow],
  );

  const runFromLastFailed = useCallback(async () => {
    const latest = latestFailedRunRef.current;
    let options = latest?.failedNodes ?? [];
    let sourceRunId = latest?.runId ?? null;

    if (!sourceRunId || options.length === 0) {
      const latest = await refreshLatestFailedRun();
      options = latest.failedNodes;
      sourceRunId = latest.runId;
    }

    if (!sourceRunId || options.length === 0) {
      toast.error("No failed run available to resume");
      return;
    }

    const firstNode = options[0];
    if (firstNode) {
      runFromFailedNodes([firstNode.nodeId], sourceRunId, "single");
    }
  }, [refreshLatestFailedRun, runFromFailedNodes]);

  const runAllFailed = useCallback(() => {
    const latest = latestFailedRunRef.current;
    const sourceRunId = latest?.runId ?? null;
    const options = latest?.failedNodes ?? [];

    if (!sourceRunId || options.length === 0) {
      toast.error("No failed run available to resume");
      return;
    }

    runFromFailedNodes(
      options.map((opt) => opt.nodeId),
      sourceRunId,
      "all-failed",
    );
  }, [runFromFailedNodes]);

  const loadHistoricalRun = useCallback(
    async (run: { runId: string }) => {
      if (!workspaceId || !workflowId) return;
      try {
        const fullRun = await apiweave.runs.get(workspaceId, run.runId);
        const resolvedSecrets = fullRun.resolvedSecrets;
        const statuses: NodeStatuses = {};
        applyRunNodeStatuses(statuses, fullRun.nodeStatuses);
        applyRunResults(statuses, fullRun.results ?? [], resolvedSecrets);
        // Not paced: opening a finished run is reading a record, not watching
        // it happen. Dropping the queue first stops a still-draining playback
        // from repainting over the run just loaded.
        choreography.reset();
        setNodes((nds) => selectiveNodeUpdate(nds, statuses));
        setCurrentRunId(fullRun.runId);
        currentRunIdRef.current = fullRun.runId;
      } catch {
        // ignore
      }
    },
    [workspaceId, workflowId, setNodes, choreography],
  );

  useEffect(() => {
    void refreshLatestFailedRun();
  }, [refreshLatestFailedRun]);

  useEffect(() => () => stopStream(), [stopStream]);

  return {
    isRunning,
    currentRunId,
    runWorkflow,
    cancelRun,
    runFromLastFailed,
    runAllFailed,
    runFromFailedNodes,
    resumeOptions,
    resumeSourceRunId,
    isResumeLoading,
    refreshLatestFailedRun,
    loadHistoricalRun,
  };
}
