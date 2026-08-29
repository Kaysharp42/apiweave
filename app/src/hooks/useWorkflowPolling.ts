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
import {
  apiweave,
  onRunProgress,
  onRunStarted,
  IpcError,
} from "../utils/apiweaveClient";
import type { RunProgressEvent } from "@shared/types/RunProgressEvent";
import { analyzeWorkflowGraph } from "@shared/analysis/workflow_graph_analyzer";
import type { WorkflowGraphInput } from "@shared/types/WorkflowGraphInput";
import type { WorkflowEdge } from "@shared/types/WorkflowEdge";
import type { WorkflowNode } from "@shared/types/WorkflowNode";
import useRunChoreography from "./useRunChoreography";
import type { PacedEvent } from "../utils/runChoreography";
import type { RunCameraHandle } from "../types/RunCameraHandle";
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

/**
 * Build the analyzer's input shape from the live canvas nodes/edges, so the
 * run gate runs the *same* diagnosis as `workflow_diagnose` rather than a
 * reimplementation that drifts. The analyzer only reads `nodeId`, `type`,
 * `label` and `config` from a node, and `edgeId`/`source`/`target`/
 * `sourceHandle` from an edge — the ReactFlow values map directly without a
 * Zod parse, so a malformed node is what the analyzer reports (not what
 * throws here).
 */
function buildAnalyzerGraphInput(
  workflowId: string | undefined,
  canvasNodes: readonly Node[],
  canvasEdges: readonly {
    id?: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }[],
): WorkflowGraphInput {
  const nodes = canvasNodes.map((node) => {
    const data = (node.data ?? {}) as Record<string, unknown>;
    const built: WorkflowNode = {
      nodeId: node.id,
      type: (node.type ?? "http-request") as WorkflowNode["type"],
      position: node.position ?? { x: 0, y: 0 },
      ...(node.data && typeof data.label === "string"
        ? { label: data.label }
        : {}),
      ...(data.config !== undefined ? { config: data.config } : {}),
    } as WorkflowNode;
    return built;
  });

  const edges = canvasEdges.map((edge) => {
    const built: WorkflowEdge = {
      edgeId: edge.id ?? `${edge.source}->${edge.target}`,
      source: edge.source,
      target: edge.target,
      sourceHandle: (edge.sourceHandle ?? null) as WorkflowEdge["sourceHandle"],
      targetHandle: (edge.targetHandle ?? null) as WorkflowEdge["targetHandle"],
    } as WorkflowEdge;
    return built;
  });

  return { workflowId, nodes, edges };
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
  // the next one is allowed to light up. Read for the run gate too (the shared
  // analyzer needs `sourceHandle`/`edgeId` to flag missing/invalid branch
  // handles), so this is the full ReactFlow edge subset the gate reads.
  edges: readonly {
    id?: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }[];
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
  /**
   * Optional run camera. It is told about the run from here rather than from the
   * canvas because the two facts it needs — when a run begins, and when a node
   * actually lights up — are only both visible at this seam: the second one
   * belongs to the playback, not to the runner.
   */
  camera?: RunCameraHandle | null;
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
  camera,
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

  // Held in a ref so the camera is never a reason to rebuild `releaseNodeStatus`
  // — it is handed to a live playback timer and to an IPC subscription.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

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
      // The camera follows what is on screen, so it is told here and not in
      // `handleEvent`: the runner can report a node running and finished inside
      // one frame, and a camera driven off that would arrive at nodes before
      // they lit up and skip past the ones it paced over.
      cameraRef.current?.onNodeShown(event.nodeId, event.status);
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
        // Released before the hydration, which repaints every node at once: the
        // camera has nothing left to follow, and a retarget racing that repaint
        // would be aiming at whatever landed first.
        cameraRef.current?.onRunSettled();
        void hydrateRunResults(runId);
      });
      void refreshLatestFailedRun();
    },
    [choreography, stopStream, hydrateRunResults, refreshLatestFailedRun],
  );

  /**
   * Put the canvas into "a run is about to be shown" state: drop the previous
   * run's unfinished narration, clear every node's result, and recompute the
   * entry points the playback releases locally.
   *
   * Extracted because a run this canvas did not start needs exactly this too —
   * see `adoptRun`. Nothing here depends on *who* started the run.
   */
  const clearCanvasForRun = useCallback(() => {
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
  }, [stopStream, choreography, nodes, setNodes]);

  /**
   * Start showing `runId`: subscribe to its progress, engage the camera, and
   * release the entry points.
   *
   * Both the Run button and an adopted agent-triggered run come through here,
   * so a run started over MCP is narrated, paced and followed by exactly the
   * same machinery — there is no second, dimmer rendering of a run.
   */
  const attachToRun = useCallback(
    (runId: string) => {
      setCurrentRunId(runId);
      currentRunIdRef.current = runId;
      setIsRunning(true);
      unsubscribeRef.current = onRunProgress(runId, handleEvent);

      // The entry point's result is the one event this subscription can never
      // receive. The progress channel is keyed by runId, so it cannot be
      // opened until the runId is known — and the runner, which starts the run
      // inside `runs.create`, has already stamped the start node as passed by
      // the time that reply (or, for an adopted run, the run-started
      // broadcast) crosses back. Its status therefore only arrived with the
      // end-of-run hydration, which left every edge out of Start grey for the
      // whole run while the rest of the canvas lit up.
      //
      // Nothing has to be told to the canvas here: a run beginning *is* the
      // entry point passing, and this side knows the moment it began. The
      // node goes through the same playback as any other, so the traversal
      // out of Start is drawn rather than snapped.
      //
      // The camera is engaged just before that, not after: enqueuing pumps the
      // playback synchronously, so the entry point's release — the camera's
      // only cue for where the run begins — happens inside the loop below.
      cameraRef.current?.onRunStart([...entryNodeIdsRef.current]);

      for (const nodeId of entryNodeIdsRef.current) {
        choreography.enqueue({ nodeId, status: "success" });
      }
    },
    [handleEvent, choreography],
  );

  const executeWorkflow = useCallback(
    async (_runOptions: RunOptions = {}) => {
      if (!workspaceId || !workflowId) return;

      // One validator: the same `analyzeWorkflowGraph` that powers
      // `workflow_diagnose`, `assertion_validate` and `assertion_apply`. The
      // previous inline gate ran a *truthiness* check on `expectedValue`, which
      // rejected `false`, `0` and `""` — perfectly valid `equals` targets —
      // while the MCP `assertion_validate` accepted them, so a valid workflow
      // was unrunnable from the canvas and the two paths disagreed.
      //
      // Scope the run-block to `assertion`-category errors — the per-rule
      // validity that `assertion_validate` covers. Topology errors (missing
      // start/end, unreachable nodes, etc.) are not a reason to block a
      // half-edited graph from a Run: the executor reports them as a failed
      // run, and the canvas is a workspace where graphs live mid-edit.
      //
      // `assertion_source_missing`/`assertion_source_ambiguous` share the
      // `assertion` category but are topology, not rule validity — an assertion
      // with zero or two upstream `http-request` nodes is the same "mid-edit"
      // state as a dangling edge, most commonly hit mid-drag while wiring a new
      // connection. Excluded so that state doesn't block a Run either.
      const diagnosis = analyzeWorkflowGraph(
        buildAnalyzerGraphInput(workflowId, nodes, edges),
      );
      const blocking = diagnosis.diagnostics.filter(
        (d) =>
          d.severity === "error" &&
          d.category === "assertion" &&
          d.code !== "assertion_source_missing" &&
          d.code !== "assertion_source_ambiguous",
      );

      if (blocking.length > 0) {
        const invalidIds = new Set(
          blocking
            .map((d) => d.nodeIds[0])
            .filter((id): id is string => typeof id === "string"),
        );
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
        const firstId = invalidIds.values().next().value;
        if (instance && firstId) {
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

        const details = blocking
          .map((d) => {
            const id = d.nodeIds[0] ?? "?";
            return `${id}: ${d.message}`;
          })
          .join(" | ");

        toast.error(`Run blocked: invalid workflow — ${details}`, {
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
        clearCanvasForRun();

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

        attachToRun(run.runId);
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
      edges,
      reactFlowInstanceRef,
      clearCanvasForRun,
      attachToRun,
    ],
  );

  /**
   * Take over the canvas for a run it did not start.
   *
   * Held in a ref, and reassigned every render, for the same reason `cameraRef`
   * is: `clearCanvasForRun` closes over `nodes`, so depending on it directly
   * would tear down and re-open the IPC subscription below on every node
   * repaint — that is, dozens of times inside the run it is trying to watch.
   * Reassignment keeps the closure over the *current* graph without making the
   * subscription's identity depend on it.
   */
  const adoptRunRef = useRef<(runId: string) => void>(() => undefined);
  adoptRunRef.current = (runId: string) => {
    clearCanvasForRun();
    attachToRun(runId);
  };

  /** Whether this canvas is free to start showing `runId`. */
  const canAdoptRun = useCallback((runId: string): boolean => {
    // The scheduler publishes `run.started` synchronously inside `runs.create`,
    // so this canvas hears about its OWN run before that call has returned it a
    // runId — there is nothing to compare against yet, only the knowledge that
    // a create of ours is in flight. An agent run starting inside that same
    // window is dropped rather than adopted, which costs one missed narration
    // and never a canvas showing two runs at once.
    if (isStartingRef.current) return false;
    if (currentRunIdRef.current === runId) return false;
    // An open stream is the one honest "a live run is on screen" test.
    // `currentRunIdRef` is also set by `loadHistoricalRun`, which is a record
    // being read rather than a run in progress and must not block adoption;
    // `isRunning` outlasts the runner, because the playback trails it. The
    // stream is opened by `attachToRun` and closed the moment the run reaches
    // a terminal event, so a still-draining playback is adoptable — the same
    // state clicking Run again would replace.
    return unsubscribeRef.current === null;
  }, []);

  /**
   * Show a run this canvas did not start — in practice, one an agent triggered
   * through the MCP `runs_create` tool.
   *
   * The run-started broadcast is unkeyed and fires for every run, so the filter
   * is here rather than at the channel: only a run of the workflow on this
   * canvas has anywhere to be drawn, since `WorkflowCanvas` is mounted per tab.
   */
  useEffect(() => {
    if (!workspaceId || !workflowId) return;
    return onRunStarted((event) => {
      if (event.workspaceId !== workspaceId) return;
      if (event.workflowId !== workflowId) return;
      if (!canAdoptRun(event.runId)) return;
      adoptRunRef.current(event.runId);
    });
  }, [workspaceId, workflowId, canAdoptRun]);

  /**
   * Adopt a run that was already in flight when this canvas mounted.
   *
   * The broadcast above is a live signal, not a backlog: a run an agent started
   * while this workflow's tab was closed — or while the user was looking at
   * another tab, since `WorkflowCanvas` is mounted per tab and unmounts with it
   * — has already announced itself to nobody. Without this, opening the
   * workflow an agent is currently running shows a still canvas.
   *
   * Only future events are streamed, so nodes that finished before this attach
   * stay grey until the end-of-run hydration paints them. Partial narration of
   * a run in progress beats none.
   */
  useEffect(() => {
    if (!workspaceId || !workflowId) return;
    let cancelled = false;
    void (async () => {
      try {
        const run = await apiweave.runs.getLatest(workspaceId, workflowId);
        if (cancelled || !run) return;
        if (run.status !== "running" && run.status !== "pending") return;
        if (!canAdoptRun(run.runId)) return;
        adoptRunRef.current(run.runId);
      } catch {
        // No readable run history is not a reason to fail opening a workflow.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, workflowId, canAdoptRun]);

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
