import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useContext,
  useMemo,
  type MutableRefObject,
} from "react";
import ReactFlow, {
  Controls,
  ControlButton,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  // Aliased: `molecules` exports a Panel of its own, and one of the two names
  // has to say which layer it belongs to.
  Panel as FlowPanel,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
  type ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";

import HTTPRequestNode from "./nodes/HTTPRequestNode";
import AssertionNode from "./nodes/AssertionNode";
import DelayNode from "./nodes/DelayNode";
import StartNode from "./nodes/StartNode";
import EndNode from "./nodes/EndNode";
import MergeNode from "./nodes/MergeNode";
import CallWorkflowNode from "./nodes/CallWorkflowNode";
import CustomEdge from "./CustomEdge";
import { RunMiniMap } from "./RunMiniMap";
import AddNodesPanel from "./AddNodesPanel";
import NodeModal from "./NodeModal";
import HistoryModal from "./HistoryModal";
import ImportToNodesPanel from "./ImportToNodesPanel";
import WorkflowJsonEditor from "./WorkflowJsonEditor";
import { PromptDialog } from "./molecules/PromptDialog";
import { RunFollowPill } from "./molecules/RunFollowPill";
import { RunTimelinePanel } from "./organisms/RunTimelinePanel";
import { AppContext } from "../App";
import { useWorkflow } from "../contexts/WorkflowContext";
import { toast } from "sonner";
import { CanvasToolbar } from "./organisms/CanvasToolbar";
import useTabStore from "../stores/TabStore";
import useSidebarStore from "../stores/SidebarStore";
import useVariableProvenanceStore from "../stores/VariableProvenanceStore";
import { computeProvenance } from "../utils/variableProvenance";
import useCanvasStore from "../stores/CanvasStore";
import useNodePresetStore from "../stores/NodePresetStore";
import useAutoSave from "../hooks/useAutoSave";
import useCanvasDrop from "../hooks/useCanvasDrop";
import useWorkflowPolling from "../hooks/useWorkflowPolling";
import useWorkflowLiveUpdates from "../hooks/useWorkflowLiveUpdates";
import useRunCamera from "../hooks/useRunCamera";
import { useClipboardActions } from "../hooks/useClipboardActions";
import { useCanvasKeyboardShortcuts } from "../hooks/useCanvasKeyboardShortcuts";
import {
  preserveCanvasRuntimeState,
  useHydration,
} from "../hooks/useHydration";
import { canvasToWorkflow, workflowToCanvas } from "../adapters/workflowCanvas";
import { WorkflowSchema } from "@shared/zod-schemas/WorkflowSchema";
import { useNodeBranchCounts } from "../hooks/useNodeBranchCounts";
import { useSwaggerRefresh } from "../hooks/useSwaggerRefresh";
import { CanvasCornerGutter, MiniMapSize } from "../constants/CanvasChrome";
import { shouldBlockDestructiveAutosave } from "../utils/workflowSaveSafety";
import {
  describeThrownSaveError,
  readSaveFailureEnvelope,
} from "../utils/workflowSaveFailure";
import { workflowDetailUrl } from "../utils/apiweaveClient";
import { autoLayout } from "../utils/autoLayout";
import { asPresetNodeType } from "../utils/nodePresets";
import { Wand2 } from "lucide-react";
import { useScopeContext } from "../hooks/useScopeContext";
import type { Workflow } from "@shared/types/Workflow";
import type { CanvasWorkflowState } from "../types/CanvasWorkflowState";
import type { WorkflowCanvasNodeData } from "../types/WorkflowCanvasNodeData";
import type { WorkflowCanvasEdgeData } from "../types/WorkflowCanvasEdgeData";
import type { WorkflowCanvasProps } from "../types/WorkflowCanvasProps";
import type { WorkflowJsonData } from "../types/WorkflowJsonData";
import { authenticatedFetch } from "../utils/apiweaveClient";
import useEnvironmentStore, {
  getSelectedEnvironment,
} from "../stores/EnvironmentStore";

const NOISE_DATA_URI =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 240 240' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const nodeTypes: NodeTypes = {
  "http-request": HTTPRequestNode as NodeTypes[string],
  assertion: AssertionNode as NodeTypes[string],
  delay: DelayNode as NodeTypes[string],
  start: StartNode as NodeTypes[string],
  end: EndNode as NodeTypes[string],
  merge: MergeNode as NodeTypes[string],
  workflow: CallWorkflowNode as NodeTypes[string],
};

const edgeTypes: EdgeTypes = {
  custom: CustomEdge as EdgeTypes[string],
};

// Module-scope on purpose: inline definitions create new refs every render and re-trigger ReactFlow layout work during pan/drag.
const reactFlowStyle = { width: "100%", height: "100%" };

const defaultEdgeOptions = { type: "custom" as const, animated: false };

// The connection being dragged is an intent, not a connection yet — dashed, in
// the "you can touch this" accent.
const connectionLineStyle = {
  stroke: "var(--aw-primary)",
  strokeWidth: 1.5,
  strokeDasharray: "4 4",
};

const fitViewOptions = {
  padding: 0.25,
  minZoom: 0.02,
  includeHiddenNodes: true,
};

// MiniMap is itself a ReactFlow panel, so it takes the corner inset directly.
// Wrapping it in one nested the two and stacked their 15px default margins,
// which is how it ended up 27px off the edge instead of the 10px written here.
// Margin — not bottom/right — is what the panel classes actually position by.
const miniMapStyle = {
  backgroundColor: "var(--aw-surface-raised)",
  border: "1px solid var(--aw-border)",
  borderRadius: "var(--aw-radius-sm)",
  width: MiniMapSize.width,
  height: MiniMapSize.height,
  margin: CanvasCornerGutter,
};

const controlsStyle = { margin: CanvasCornerGutter };

// WeakMap IDs track extractor-config identity by ref so the signature doesn't churn during position-only drag frames.
const extractorConfigIdMap = new WeakMap<object, number>();
let nextExtractorConfigId = 0;
// Same idea for full node configs, so the provenance signature only changes on
// real config edits (add/remove extractor, new {{variables.X}} ref) — not drag.
const configRefMap = new WeakMap<object, number>();
let nextConfigRefId = 0;

const initialNodes: Node<WorkflowCanvasNodeData>[] = [
  {
    id: "start-1",
    type: "start",
    position: { x: 250, y: 50 },
    data: { label: "Start" },
  },
];

export function WorkflowCanvas({
  workflowId,
  workflow,
  showVariablesPanel = false,
  onShowVariablesPanel = () => {},
}: WorkflowCanvasProps) {
  const context = useContext(AppContext);
  const { darkMode, autoSaveEnabled } = context || {
    darkMode: false,
    autoSaveEnabled: true,
  };
  const scope = useScopeContext();

  const darkModeRef = useRef(darkMode);
  useEffect(() => {
    darkModeRef.current = darkMode;
  }, [darkMode]);

  const {
    variables: workflowVariables,
    registerExtractors,
    updateVariables,
    onVariablesDeletedRef,
  } = useWorkflow();
  const setProvenance = useVariableProvenanceStore((s) => s.setProvenance);

  const [nodes, setNodes, onNodesChange] =
    useNodesState<WorkflowCanvasNodeData>(initialNodes);
  const [edges, setEdges, onEdgesChange] =
    useEdgesState<WorkflowCanvasEdgeData>([]);

  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const edgesRef = useRef(edges);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  const onNodesChangeRef = useRef(onNodesChange);
  useEffect(() => {
    onNodesChangeRef.current = onNodesChange;
  }, [onNodesChange]);

  const onEdgesChangeRef = useRef(onEdgesChange);
  useEffect(() => {
    onEdgesChangeRef.current = onEdgesChange;
  }, [onEdgesChange]);

  const workflowVariablesRef = useRef(workflowVariables);
  useEffect(() => {
    workflowVariablesRef.current = workflowVariables;
  }, [workflowVariables]);

  const reactFlowInstanceRef = useRef<ReactFlowInstance<
    WorkflowCanvasNodeData,
    WorkflowCanvasEdgeData
  > | null>(null) as MutableRefObject<ReactFlowInstance<
    WorkflowCanvasNodeData,
    WorkflowCanvasEdgeData
  > | null>;
  // Holds the latest saveWorkflow (defined below); the run hook awaits it to
  // flush pending edits before executing so it never runs a stale graph.
  const saveWorkflowRef = useRef<((silent: boolean) => Promise<void>) | null>(
    null,
  );
  const hydrationVersionRef = useRef(0);

  // ── Run camera ──────────────────────────────────────────────────────
  //
  // Declared up here, ahead of the run hook, because the run hook is what tells
  // it about the run. The instance ref above is the same object `onInit` fills
  // in, so the camera has a handle on ReactFlow long before the canvas mounts.

  const canvasRef = useRef<HTMLElement | null>(null);

  const {
    camera: runCamera,
    isFollowing: isFollowingRun,
    isSuspended: isFollowSuspended,
    isCameraMoving,
    suspend: suspendFollow,
    resume: resumeFollow,
    onViewportInteraction,
  } = useRunCamera({
    instanceRef: reactFlowInstanceRef,
    nodesRef,
    edgesRef,
    containerRef: canvasRef,
  });
  const [modalNode, setModalNode] =
    useState<Node<WorkflowCanvasNodeData> | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showImportToNodes, setShowImportToNodes] = useState(false);
  const [showJsonEditor, setShowJsonEditor] = useState(false);
  const [timelineRunId, setTimelineRunId] = useState<string | null>(null);
  // The node a pending "Save as preset" action is naming, held here (not in
  // CanvasStore) because only the canvas can resolve a nodeId to its live
  // type + config.
  const [presetSource, setPresetSource] =
    useState<Node<WorkflowCanvasNodeData> | null>(null);
  const environments = useEnvironmentStore((s) => s.environments);
  const selectedEnvMap = useEnvironmentStore(
    (s) => s.selectedEnvironmentByWorkflow,
  );
  const selectedEnvironment = useMemo<string | null>(
    () =>
      getSelectedEnvironment(
        workflowId ?? "",
        workflow?.selectedEnvironmentId ?? undefined,
      ),
    [workflowId, workflow?.selectedEnvironmentId, selectedEnvMap],
  );

  // ── Hooks ──────────────────────────────────────────────────────────

  const isEditorOverlayOpen =
    !!modalNode || showJsonEditor || showImportToNodes || showHistory;

  const { selectedNodeRef, newDuplicateNodeRef } = useClipboardActions({
    nodes,
    setNodes,
    isEditorOverlayOpen,
  });

  const { isHydrated, hydratedBaselineRef, noteSavedWorkflow } = useHydration({
    workflow,
    setNodes,
    setEdges,
  });

  useNodeBranchCounts({
    edges,
    nodes,
    setNodes,
  });

  const { isSwaggerRefreshing, handleManualSwaggerRefresh } = useSwaggerRefresh(
    {
      workflowId,
      selectedEnvironment,
      environments,
      setNodes,
    },
  );

  const {
    isRunning,
    runWorkflow,
    cancelRun,
    runFromLastFailed,
    runAllFailed,
    runFromFailedNodes,
    resumeOptions,
    resumeSourceRunId,
    isResumeLoading,
    loadHistoricalRun,
  } = useWorkflowPolling({
    workspaceId: scope.workspaceId,
    workflowId,
    nodes,
    edges,
    setNodes,
    selectedEnvironment,
    reactFlowInstanceRef,
    saveWorkflowRef,
    camera: runCamera,
  });

  // ── Extractors effect ───────────────────────────────────────────────

  const extractorsSig = useMemo(() => {
    const parts: string[] = [];
    for (const node of nodes) {
      if (node.type === "http-request" && node.data?.config?.extractors) {
        const extractors = node.data.config.extractors as object;
        let id = extractorConfigIdMap.get(extractors);
        if (id === undefined) {
          id = nextExtractorConfigId++;
          extractorConfigIdMap.set(extractors, id);
        }
        parts.push(`${node.id}:${id}`);
      }
    }
    return parts.join("|");
  }, [nodes]);

  useEffect(() => {
    const extractorsFromNodes: Record<string, string> = {};
    nodesRef.current.forEach((node) => {
      if (node.type === "http-request" && node.data?.config?.extractors) {
        Object.entries(node.data.config.extractors).forEach(([name, value]) => {
          if (typeof value === "string") {
            extractorsFromNodes[name] = value;
          }
        });
      }
    });
    registerExtractors(extractorsFromNodes);
  }, [extractorsSig, registerExtractors]);

  // ── Variable provenance (feature 5.2) ───────────────────────────────
  // Rebuild the producer/consumer map whenever a node config actually changes
  // (not on position-only drag frames). View panels read it from the store.
  const provenanceSig = useMemo(() => {
    const parts: string[] = [];
    for (const node of nodes) {
      const cfg = node.data?.config;
      if (cfg !== null && typeof cfg === "object" && !Array.isArray(cfg)) {
        let id = configRefMap.get(cfg as object);
        if (id === undefined) {
          id = nextConfigRefId++;
          configRefMap.set(cfg as object, id);
        }
        parts.push(`${node.id}:${id}:${JSON.stringify(node.data?.label ?? null)}`);
      } else {
        parts.push(`${node.id}:0:${JSON.stringify(node.data?.label ?? null)}`);
      }
    }
    return parts.join("|");
  }, [nodes]);

  useEffect(() => {
    setProvenance(computeProvenance(nodesRef.current));
  }, [provenanceSig, setProvenance]);

  // ── Variables deletion effect ───────────────────────────────────────

  useEffect(() => {
    onVariablesDeletedRef.current = (deletedVars: string[]) => {
      if (!deletedVars || deletedVars.length === 0) return;
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          if (node.type === "http-request" && node.data?.config?.extractors) {
            const updatedExtractors = {
              ...node.data.config.extractors,
            } as Record<string, unknown>;
            let modified = false;
            deletedVars.forEach((varName) => {
              if (varName in updatedExtractors) {
                delete updatedExtractors[varName];
                modified = true;
              }
            });
            if (modified) {
              return {
                ...node,
                data: {
                  ...node.data,
                  config: {
                    ...node.data.config,
                    extractors: updatedExtractors,
                  },
                },
              };
            }
          }
          return node;
        }),
      );
    };
    return () => {
      onVariablesDeletedRef.current = null;
    };
  }, [setNodes, onVariablesDeletedRef]);

  // ── Workflow reload from server ─────────────────────────────────────

  /**
   * Put a server-authoritative workflow on the canvas.
   *
   * Nodes keep their per-node runtime state (run status, results) across the
   * swap — the graph came back from the server, but what the last run did to it
   * did not. The tab's own copy is refreshed with it, so anything reading the
   * workflow from there sees the same revision the canvas is showing.
   */
  const showWorkflow = useCallback(
    (canvasState: CanvasWorkflowState, source: Workflow) => {
      hydrationVersionRef.current += 1;
      setNodes((previousNodes) =>
        preserveCanvasRuntimeState(canvasState.nodes, previousNodes),
      );
      setEdges(canvasState.edges);
      updateVariables(canvasState.variables);
      if (workflowId) {
        useTabStore.getState().updateTabWorkflow(workflowId, source);
        useSidebarStore.getState().signalWorkflowsRefresh();
      }
      hydratedBaselineRef.current = {
        nodeCount: canvasState.nodes.length,
        edgeCount: canvasState.edges.length,
      };
    },
    [workflowId, setNodes, setEdges, updateVariables],
  );

  const reloadWorkflowFromServer = useCallback(async () => {
    if (!workflowId || !scope.workspaceId) return;

    try {
      const response = await authenticatedFetch(
        workflowDetailUrl(scope.workspaceId, workflowId),
      );
      if (response.ok) {
        const reloadedWorkflow = WorkflowSchema.parse(await response.json());
        showWorkflow(workflowToCanvas(reloadedWorkflow), reloadedWorkflow);
      }
    } catch (err) {
      console.error("Error reloading workflow:", err);
    }
  }, [workflowId, scope.workspaceId, showWorkflow]);

  useEffect(() => {
    if (!workflowId) return;

    return useCanvasStore
      .getState()
      .registerWorkflowReloadHandler(workflowId, () => {
        void reloadWorkflowFromServer();
      });
  }, [reloadWorkflowFromServer, workflowId]);

  useWorkflowLiveUpdates({
    workspaceId: scope.workspaceId,
    workflowId,
    workflow,
    nodes,
    edges,
    variables: workflowVariables,
    onWorkflow: (incoming) => {
      noteSavedWorkflow(incoming);
      showWorkflow(workflowToCanvas(incoming), incoming);
    },
  });

  // "Save as preset" reaches the canvas as a CanvasStore pending action (the
  // same channel duplicate/copy use, since a node component can't see the
  // graph). The canvas resolves the id to a live node and opens the name prompt;
  // the IPC write happens on submit.
  useEffect(() => {
    return useCanvasStore.getState().registerPendingActionHandler((action) => {
      if (action.type !== "save-preset" || !action.nodeId) return;
      const node = nodesRef.current.find((n) => n.id === action.nodeId);
      if (!node || asPresetNodeType(node.type) === null) {
        toast.error("This node type can't be saved as a preset");
        return;
      }
      setPresetSource(node);
    });
  }, []);

  const handleSavePreset = useCallback(
    (name: string) => {
      const node = presetSource;
      const nodeType = asPresetNodeType(node?.type);
      setPresetSource(null);
      if (!node || nodeType === null) return;
      if (!scope.workspaceId) {
        toast.error("No workspace selected");
        return;
      }
      void useNodePresetStore
        .getState()
        .savePreset({
          workspaceId: scope.workspaceId,
          name,
          nodeType,
          config: (node.data.config as Record<string, unknown>) ?? {},
        })
        .then(() => toast.success(`Saved preset "${name}"`))
        .catch((err: unknown) =>
          toast.error(
            err instanceof Error
              ? `Could not save preset: ${err.message}`
              : "Could not save preset",
          ),
        );
    },
    [presetSource, scope.workspaceId],
  );

  // ── Node change handlers ────────────────────────────────────────────

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      const filteredChanges = changes.filter((change) => {
        if (
          change.type === "select" &&
          newDuplicateNodeRef.current === change.id
        ) {
          return false;
        }
        return true;
      });
      onNodesChangeRef.current(filteredChanges);
    },
    [],
  );

  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      onEdgesChangeRef.current(changes);
    },
    [],
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node<WorkflowCanvasNodeData>) => {
      selectedNodeRef.current = node;
      // Choosing a node to look at mid-run is a choice about where to look, so
      // the camera stops moving until it is asked back.
      suspendFollow();
    },
    [suspendFollow],
  );

  const onPaneClick = useCallback(() => {
    selectedNodeRef.current = null;
  }, []);

  const onNodeDragStart = useCallback(() => {
    // isDraggingNodeRef removed — auto-save skips during drag via isSwaggerRefreshing guard
    // Dragging a node under a moving camera is unusable; the camera yields.
    suspendFollow();
  }, [suspendFollow]);

  const onNodeDragStop = useCallback(() => {
    // Drag stop handler — no-op, auto-save resumes naturally
  }, []);

  const onNodeDoubleClick = useCallback(
    (event: React.MouseEvent, node: Node<WorkflowCanvasNodeData>) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
        )
      ) {
        return;
      }
      if (node.type !== "start" && node.type !== "end") {
        setModalNode(node);
      }
    },
    [],
  );

  const handleModalSave = useCallback(
    (updatedNode: Node<WorkflowCanvasNodeData>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === updatedNode.id ? updatedNode : n)),
      );
    },
    [setNodes],
  );

  // ── Canvas drop ─────────────────────────────────────────────────────

  const { onDrop, onDragOver } = useCanvasDrop({
    reactFlowInstanceRef,
    setNodes,
  });

  // ── Connect handler ─────────────────────────────────────────────────

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => {
        const currentNodes = nodesRef.current;
        const sourceNode = currentNodes.find((n) => n.id === params.source);
        const isAssertionSource = sourceNode?.type === "assertion";

        if (isAssertionSource && params.sourceHandle) {
          // No `style`: `CustomEdge` reserves colour for run state, and the
          // pass/fail socket already identifies the branch. Styling it here
          // never survived a reload either — `canvasToWorkflow` strips
          // `style` — so the edge changed appearance between drawing it and
          // reopening the workflow. Only the label persists.
          const newEdge = {
            id: `reactflow__edge-${params.source}${params.sourceHandle || ""}-${params.target}${params.targetHandle || ""}`,
            ...params,
            type: "custom",
            label: params.sourceHandle === "pass" ? "Pass" : "Fail",
          } as Edge<WorkflowCanvasEdgeData>;
          return [...eds, newEdge];
        }

        const edgesWithNewConnection = addEdge(
          { ...params, type: "custom" } as Parameters<typeof addEdge>[0],
          eds,
        );

        if (edgesWithNewConnection.length === eds.length) {
          // addEdge deduped a connection that already exists; nothing to add.
          return eds;
        }

        const newEdge = edgesWithNewConnection[eds.length];

        const parallelEdges = eds.filter((e) => e.source === params.source);

        if (parallelEdges.length > 0) {
          const updatedEdges = eds
            .map((e): Edge<WorkflowCanvasEdgeData> => {
              if (e.source === params.source) {
                const branchIndex = parallelEdges.findIndex(
                  (pe) => pe.id === e.id,
                );
                return {
                  ...e,
                  // Neither `animated` nor `style`. The animated flag dashed
                  // and marched the edge forever, so a canvas with parallel
                  // branches was in permanent motion whether or not anything
                  // was running; `style` painted it a fixed colour, which
                  // `CustomEdge` then treated as the edge's own and never let
                  // run state overwrite. Neither survived a reload — the paths
                  // in `workflowCanvas.ts` set neither — so a branch edge also
                  // changed appearance between drawing it and reopening the
                  // workflow. The label is the part worth keeping: it persists.
                  label: `Branch ${branchIndex}`,
                } as Edge<WorkflowCanvasEdgeData>;
              }
              return e;
            })
            .concat([
              {
                ...newEdge,
                type: "custom",
                label: `Branch ${parallelEdges.length}`,
              } as Edge<WorkflowCanvasEdgeData>,
            ]);
          return updatedEdges as Edge<WorkflowCanvasEdgeData>[];
        }

        return edgesWithNewConnection as Edge<WorkflowCanvasEdgeData>[];
      });
    },
    [setEdges],
  );

  // ── Save workflow ────────────────────────────────────────────────────

  const saveWorkflow = useCallback(
    async (silent = false) => {
      if (!scope.workspaceId || !workflow) return;

      try {
        const canonicalWorkflow = canvasToWorkflow(
          {
            nodes: nodesRef.current,
            edges: edgesRef.current,
            variables: workflowVariablesRef.current,
            selectedEnvironmentId: selectedEnvironment,
          },
          workflow,
        );
        const workflowPayload = {
          nodes: canonicalWorkflow.nodes,
          edges: canonicalWorkflow.edges,
          variables: canonicalWorkflow.variables,
          selectedEnvironmentId:
            canonicalWorkflow.selectedEnvironmentId ?? null,
        };

        const nodeCount = workflowPayload.nodes.length;
        const edgeCount = workflowPayload.edges.length;
        if (
          silent &&
          shouldBlockDestructiveAutosave(
            workflowPayload.nodes,
            workflowPayload.edges,
            hydratedBaselineRef.current,
          )
        ) {
          console.warn("[workflow-save-blocked]", {
            workflowId,
            reason: "destructive-autosave-protection",
            baseline: hydratedBaselineRef.current,
            nodeCount,
            edgeCount,
          });
          return;
        }

        const response = await authenticatedFetch(
          workflowDetailUrl(scope.workspaceId, workflowId ?? ""),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(workflowPayload),
          },
        );

        if (response.ok) {
          const savedWorkflow = WorkflowSchema.parse(await response.json());
          hydratedBaselineRef.current = { nodeCount, edgeCount };
          // This echo is our own graph coming back. Claim it before the tab
          // store hands it to `useHydration`, or the canvas re-hydrates from
          // its own save and drops the run it is displaying.
          noteSavedWorkflow(savedWorkflow);
          useTabStore.getState().markClean(workflowId ?? "");
          useTabStore
            .getState()
            .updateTabWorkflow(workflowId ?? "", savedWorkflow);
        } else {
          // The server says WHY it refused (a missing environment, a stale
          // workspace, a rejected node). Both the toast and the console log
          // must name that reason, or nobody — user or debugger — can tell
          // what to fix.
          const { detail, code, issues } = await readSaveFailureEnvelope(
            response,
          );
          const cause =
            detail ??
            issues[0] ??
            (code ? `the request was rejected (${code})` : undefined);
          console.error("[workflow-save-failed]", {
            workflowId,
            status: response.status,
            code: code ?? null,
            detail: detail ?? null,
            issues,
          });
          toast.error(
            cause
              ? `Failed to save workflow — ${cause}`
              : "Failed to save workflow — your changes are not saved",
            { id: `workflow-save-error-${workflowId}` },
          );
        }
      } catch (error) {
        // The save never reached the server: the canvas state failed local
        // validation, or the fetch itself threw. Log the full error for the
        // debugging session and put its most specific sentence in the toast.
        const cause = describeThrownSaveError(error);
        console.error("[workflow-save-failed]", {
          workflowId,
          cause: cause ?? null,
          error,
        });
        toast.error(
          cause
            ? `Failed to save workflow — ${cause}`
            : "Failed to save workflow — your changes are not saved",
          { id: `workflow-save-error-${workflowId}` },
        );
      }
    },
    [
      workflowId,
      scope.workspaceId,
      selectedEnvironment,
      workflow,
      noteSavedWorkflow,
    ],
  );

  // Keep the run hook's flush pointer at the latest saveWorkflow closure.
  saveWorkflowRef.current = saveWorkflow;

  useCanvasKeyboardShortcuts({
    isEditorOverlayOpen,
    isRunning,
    onSave: () => saveWorkflow(false),
    onRun: runWorkflow,
    onToggleJsonEditor: () => {
      if (!isHydrated) {
        toast.info("Workflow is still loading. Try JSON again in a moment.");
        return;
      }
      setShowJsonEditor(true);
    },
  });

  // ── JSON editor ──────────────────────────────────────────────────────

  const workflowJsonMemo = useMemo(
    (): WorkflowJsonData => ({
      nodes: nodes.map((node) => ({
        nodeId: node.id,
        type: node.type ?? "",
        ...(node.data.label ? { label: node.data.label } : {}),
        position: node.position,
        config: node.data.config || {},
      })),
      edges: edges.map((edge) => ({
        edgeId: edge.id,
        source: edge.source,
        target: edge.target,
        ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
        ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
        ...(typeof edge.label === "string" ? { label: edge.label } : {}),
      })),
      variables: workflowVariables,
    }),
    [nodes, edges, workflowVariables],
  );

  const handleJsonApply = useCallback(
    async (parsed: Record<string, unknown>) => {
      try {
        if (!scope.workspaceId || !workflowId || !workflow) return;
        const editedWorkflow = WorkflowSchema.parse({
          ...workflow,
          nodes: parsed.nodes,
          edges: parsed.edges,
          variables: parsed.variables ?? workflowVariables,
        });
        const response = await authenticatedFetch(
          workflowDetailUrl(scope.workspaceId, workflowId),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              nodes: editedWorkflow.nodes,
              edges: editedWorkflow.edges,
              variables: editedWorkflow.variables,
            }),
          },
        );
        if (response.ok) {
          const savedWorkflow = WorkflowSchema.parse(await response.json());
          const canvasState = workflowToCanvas(savedWorkflow);
          hydratedBaselineRef.current = {
            nodeCount: canvasState.nodes.length,
            edgeCount: canvasState.edges.length,
          };
          noteSavedWorkflow(savedWorkflow);
          showWorkflow(canvasState, savedWorkflow);

          setShowJsonEditor(false);
          toast.success("Workflow updated from JSON editor");
        } else {
          try {
            const errBody = (await response.json()) as {
              detail?: string | Array<{ loc?: string[]; msg?: string }>;
            };
            if (errBody.detail && Array.isArray(errBody.detail)) {
              const messages = errBody.detail.map((d) => {
                const loc = d.loc ? d.loc.slice(1).join(" → ") : "";
                return `${loc}: ${d.msg}`;
              });
              toast.error(messages.join("\n"));
            } else {
              toast.error(
                (errBody.detail as string) ||
                  `Save failed (${response.status})`,
              );
            }
          } catch {
            toast.error(`Save failed with status ${response.status}`);
          }
        }
      } catch (err) {
        console.error("JSON editor save error:", err);
        toast.error("Network error -- see console");
      }
    },
    [
      showWorkflow,
      workflowId,
      scope.workspaceId,
      workflow,
      workflowVariables,
      noteSavedWorkflow,
    ],
  );

  // ── Auto-save ────────────────────────────────────────────────────────

  useAutoSave({
    workflowId,
    autoSaveEnabled: autoSaveEnabled && !isRunning && !isSwaggerRefreshing,
    isHydrated,
    nodes,
    edges,
    workflowVariables,
    resetSnapshotKey: hydrationVersionRef.current,
    saveWorkflow,
  });

  // ── Minimap & visual config ─────────────────────────────────────────

  const getNodeColor = useCallback((n: Node<WorkflowCanvasNodeData>) => {
    if (n.data?.executionStatus === "running")
      return "var(--aw-status-running)";
    if (n.data?.executionStatus === "success")
      return "var(--aw-status-success)";
    if (n.data?.executionStatus === "error") return "var(--aw-status-error)";

    if (n.type === "start") return "var(--aw-primary-light)";
    if (n.type === "end") return "var(--aw-status-error)";
    if (n.type === "httpRequest" || n.type === "http-request")
      return "var(--aw-status-info)";
    if (n.type === "assertion") return "var(--aw-status-success)";
    if (n.type === "delay") return "var(--aw-status-warning)";
    if (n.type === "merge") return "var(--aw-branch-edge)";

    return "var(--aw-text-muted)";
  }, []);

  const getNodeStrokeColor = useCallback((n: Node<WorkflowCanvasNodeData>) => {
    if (n.data?.executionStatus === "error") return "var(--aw-status-error)";
    return "var(--aw-border)";
  }, []);

  const rfInstanceRef = useRef<
    Parameters<NonNullable<Parameters<typeof ReactFlow>[0]["onInit"]>>[0] | null
  >(null);

  const handleInit = useCallback<
    NonNullable<Parameters<typeof ReactFlow>[0]["onInit"]>
  >((instance) => {
    rfInstanceRef.current = instance;
    (reactFlowInstanceRef as React.MutableRefObject<unknown>).current =
      instance;
  }, []);

  // Position changes flow through onNodesChange, so the 700ms autosave persists them.
  const handleAutoLayout = useCallback(() => {
    // Re-laying out the graph and then fitting it is a camera act of its own; a
    // run camera still following would take the view straight back off it.
    suspendFollow();
    setNodes((nds) => autoLayout(nds, edgesRef.current));
    requestAnimationFrame(() => rfInstanceRef.current?.fitView(fitViewOptions));
  }, [setNodes, suspendFollow]);

  /*
   * The camera moves during a run, and only during a run — see `useRunCamera`.
   *
   * The rule this replaced was "the camera never moves", on the grounds that
   * moving it out from under someone watching a specific node discards where
   * they chose to look. That reasoning was right and still holds; what was wrong
   * was the conclusion. On a 130-node workflow, fit-view renders every node a
   * few pixels wide, so "where they chose to look" was nowhere: the run played
   * out too small to read and the choice was theoretical.
   *
   * So the camera follows the run, and the original objection becomes the
   * constraint rather than the verdict: the first pan, zoom, node click or drag
   * hands it straight back and nothing takes it again except the pill. Outside a
   * run nothing here moves the camera — fitting the view is a deliberate act,
   * via the auto-layout control and ReactFlow's own fit-view button, and that
   * includes the end of a run: the camera stays where the last node was rather
   * than pulling back out to the overview it was called in to escape.
   */

  return (
    <main
      ref={canvasRef}
      className="w-full h-full min-h-0 relative overflow-hidden bg-surface dark:bg-surface-dark text-text-primary dark:text-text-primary-dark transition-colors duration-300"
      aria-label="Workflow canvas"
    >
      <div
        className="absolute inset-0 opacity-[0.05] dark:opacity-[0.07] bg-[linear-gradient(currentColor_1px,transparent_1px),linear-gradient(90deg,currentColor_1px,transparent_1px)] bg-[size:32px_32px] text-text-primary dark:text-text-primary-dark pointer-events-none"
        aria-hidden="true"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.04] dark:opacity-[0.07] pointer-events-none mix-blend-multiply dark:mix-blend-screen"
        style={{
          backgroundImage: NOISE_DATA_URI,
          backgroundSize: "240px 240px",
        }}
      />
      <ReactFlow
        className="relative z-10 bg-transparent"
        style={reactFlowStyle}
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={onNodeDoubleClick}
        // ReactFlow passes the d3 source event through, and its own transitions
        // have none — so this fires with an event only when a hand is actually
        // on the canvas, including one that grabs it mid-glide.
        onMoveStart={onViewportInteraction}
        onInit={handleInit}
        onDrop={onDrop}
        onDragOver={onDragOver}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        connectionLineType={ConnectionLineType.Bezier}
        connectionLineStyle={connectionLineStyle}
        fitView
        fitViewOptions={fitViewOptions}
        minZoom={0.02}
        maxZoom={2.5}
        deleteKeyCode="Delete"
        multiSelectionKeyCode="Control"
        // While the run camera moves, only the slice of the graph it frames is
        // mounted — a 130-node workflow keeps about a dozen nodes in the DOM
        // instead of all of them, and that is the per-frame cost `setViewport`
        // pays on every write. Off-screen nodes keep their measured dimensions,
        // so the minimap and the camera keep their positions without them.
        onlyRenderVisibleElements
      >
        {/* The grid should be felt, not read. */}
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="color-mix(in srgb, var(--aw-text-muted) 22%, transparent)"
        />

        <Controls
          position="bottom-left"
          style={controlsStyle}
          fitViewOptions={fitViewOptions}
          showInteractive={false}
          // These move the camera through ReactFlow's own transitions, which
          // carry no source event — so `onMoveStart` cannot tell them apart from
          // the run camera's moves. They are the most deliberate camera acts
          // there are, so they are reported here instead.
          onZoomIn={suspendFollow}
          onZoomOut={suspendFollow}
          onFitView={suspendFollow}
        >
          <ControlButton onClick={handleAutoLayout} title="Auto-layout">
            <Wand2 />
          </ControlButton>
        </Controls>

        {/* Only while a run is still going and the user has taken the camera:
            the way back has to be one click, or looking at something mid-run
            costs you the rest of the run. */}
        {isFollowingRun && isFollowSuspended && (
          <FlowPanel position="bottom-center">
            <RunFollowPill onResume={resumeFollow} />
          </FlowPanel>
        )}

        {/* The action stack in AddNodesPanel sits directly above this, keyed off
            the same shared geometry — see constants/CanvasChrome. Frozen while
            the run camera is mid-motion, so following a run costs the minimap
            no repaints. */}
        <RunMiniMap
          nodes={nodes}
          frozen={isCameraMoving}
          position="bottom-right"
          paint={{
            nodeColor: getNodeColor,
            nodeStrokeColor: getNodeStrokeColor,
            nodeStrokeWidth: 1,
            maskColor: darkMode
              ? "color-mix(in srgb, var(--aw-surface) 64%, transparent)"
              : "color-mix(in srgb, var(--aw-text-primary) 5%, transparent)",
          }}
          style={miniMapStyle}
          zoomable
          pannable
        />
      </ReactFlow>

      <CanvasToolbar
        onSave={() => saveWorkflow(false)}
        onHistory={() => setShowHistory(true)}
        onJsonEditor={() => {
          if (!isHydrated) {
            toast.info(
              "Workflow is still loading. Try JSON again in a moment.",
            );
            return;
          }
          setShowJsonEditor(true);
        }}
        onImport={() => setShowImportToNodes(true)}
        onRun={runWorkflow}
        onCancel={cancelRun}
        onRunFromLastFailed={runFromLastFailed}
        onRunAllFailed={runAllFailed}
        onRunFromFailedNode={(nodeId) => {
          if (resumeSourceRunId) {
            runFromFailedNodes([nodeId], resumeSourceRunId, "single");
          }
        }}
        isRunning={isRunning}
        environments={environments}
        {...(selectedEnvironment ? { selectedEnvironment } : {})}
        onRefreshSwagger={handleManualSwaggerRefresh}
        isSwaggerRefreshing={isSwaggerRefreshing}
        resumeOptions={resumeOptions}
        isResumeLoading={isResumeLoading}
        onEnvironmentChange={(val) => {
          const processed = val && val.trim() ? val.trim() : null;
          const wfId = workflowId ?? "";
          if (processed) {
            useEnvironmentStore.getState().setSelectedEnv(wfId, processed);
            useEnvironmentStore.getState().setDefaultEnv(processed);
          } else {
            useEnvironmentStore.getState().clearSelectedEnv(wfId);
          }
          const selectedEnv = processed
            ? environments.find((e) => e.environmentId === processed)
            : undefined;
          const envName = selectedEnv ? selectedEnv.name : "No Environment";
          toast.success(`Environment: ${envName}`);
        }}
        workflowId={workflowId ?? ""}
      />

      <AddNodesPanel
        isModalOpen={!!modalNode}
        showVariablesPanel={showVariablesPanel}
        onShowVariablesPanel={onShowVariablesPanel}
        workspaceId={scope.workspaceId ?? ""}
      />

      {/* Keyed by node id so each open re-mounts with that node's label
          prefilled — PromptDialog seeds its input from `defaultValue` once. */}
      <PromptDialog
        key={`preset-${presetSource?.id ?? "none"}`}
        open={presetSource !== null}
        onClose={() => setPresetSource(null)}
        onSubmit={handleSavePreset}
        title="Save as preset"
        message="Adds this node's configuration to the workspace preset library, ready to drag onto any canvas."
        placeholder="e.g. Standard auth headers"
        defaultValue={String(presetSource?.data.label ?? "")}
        submitLabel="Save preset"
      />

      {modalNode && (
        <NodeModal
          key={modalNode.id}
          open={true}
          node={{
            ...modalNode,
            type: modalNode.type as
              | "http-request"
              | "assertion"
              | "delay"
              | "merge"
              | "start"
              | "end"
              | "workflow",
            data: {
              ...modalNode.data,
              label: String(modalNode.data.label || ""),
              config: (modalNode.data.config as Record<string, unknown>) || {},
            },
          }}
          onClose={() => setModalNode(null)}
          onSave={(node) =>
            handleModalSave(node as Node<WorkflowCanvasNodeData>)
          }
          workspaceId={scope.workspaceId ?? ""}
          currentWorkflowId={workflowId ?? ""}
        />
      )}

      {showHistory && (
        <HistoryModal
          workflowId={workflowId ?? ""}
          workspaceId={scope.workspaceId ?? ""}
          onClose={() => setShowHistory(false)}
          onSelectRun={loadHistoricalRun}
          onShowTimeline={(runId) => {
            setTimelineRunId(runId);
            setShowHistory(false);
          }}
        />
      )}

      <RunTimelinePanel
        isOpen={timelineRunId !== null}
        onClose={() => setTimelineRunId(null)}
        workspaceId={scope.workspaceId ?? null}
        runId={timelineRunId}
      />

      {showImportToNodes && (
        <ImportToNodesPanel
          isOpen={showImportToNodes}
          onClose={() => setShowImportToNodes(false)}
          workflowId={workflowId ?? ""}
        />
      )}

      {showJsonEditor && (
        <WorkflowJsonEditor
          open={true}
          workflowJson={workflowJsonMemo as unknown as Record<string, unknown>}
          onApply={handleJsonApply}
          onClose={() => {
            setShowJsonEditor(false);
          }}
        />
      )}
    </main>
  );
}

export default WorkflowCanvas;
