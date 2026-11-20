import { useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  CheckCircle2,
  Cookie,
  FileText,
  Filter,
  GitMerge,
  KeyRound,
  Link2,
  ListChecks,
  MousePointerClick,
  Radio,
  Settings,
  Waypoints,
  SlidersHorizontal,
  SquareCode,
  Timer,
} from "lucide-react";
import { Badge } from "./atoms/Badge";
import { TemplateInput } from "./molecules/TemplateAutocomplete";
import { Tooltip } from "./atoms/Tooltip";
import { Modal } from "./molecules/Modal";
import ButtonSelect from "./ButtonSelect";
import {
  HTTPRequestConfigPanel,
  SseConfigPanel,
  WebsocketConfigPanel,
  GrpcConfigPanel,
  BrowserConfigPanel,
  BrowserOutputPanel,
  HttpRequestOutputPanel,
  NodeOutputPanel,
  SnapshotReview,
  AssertionConfigPanel,
  DelayConfigPanel,
  MergeConfigPanel,
  WorkflowCallConfigPanel,
  NodeModalShell,
} from "./node-modal";
import { normalizeHttpRequestConfig } from "./node-modal/httpRequestConfigCompat";
import { readSnapshotActual } from "../utils/snapshotActual";
import type { AssertionEvaluation } from "@shared/types/AssertionEvaluation";
import type { HttpMethod } from "@shared/types/HttpMethod";
import { HttpMethodSchema } from "@shared/zod-schemas/HttpMethodSchema";
import type { NodeModalProps } from "../types/NodeModalProps";
import type { NodeModalNodeType } from "../types/NodeModalNodeType";
import type { NodeModalHTTPRequestConfig } from "../types/NodeModalHTTPRequestConfig";
import type { NodeModalMergeConfig } from "../types/NodeModalMergeConfig";
import { matchShortcut } from "../constants/keyboardShortcuts";
import type { NodeModalWorkflowCallConfig } from "../types/NodeModalWorkflowCallConfig";
import type {
  BrowserOutputPanelProps,
  NodeModalAssertionConfig,
  NodeModalAssertionTabKey,
  NodeModalDelayConfig,
  NodeModalDelayTabKey,
  NodeModalHttpTabKey,
  NodeModalSseConfig,
  NodeModalSseTabKey,
  NodeModalWebsocketConfig,
  NodeModalWebsocketTabKey,
  NodeModalGrpcConfig,
  NodeModalGrpcTabKey,
  NodeModalBrowserTabKey,
  NodeModalMergeTabKey,
  NodeModalShellTab,
  NodeEditorDraft,
  NodeEditorHandle,
  NodeEditorProps,
  NodeEditorSteps,
  SelectOption,
} from "../types";

// `node.data.config || {}` would otherwise mint a new object every render for
// a config-less node, which HTTPRequestConfigPanel's initialConfig-keyed sync
// effect reads as "a different node opened" on every keystroke.
const EMPTY_CONFIG: Record<string, never> = {};

const NO_CONFIG_TYPES: NodeModalNodeType[] = ["start", "end"];

/** The rule evaluations an Assertion node's last result carries, if any. */
function assertionEvaluations(result: unknown): readonly AssertionEvaluation[] {
  if (typeof result !== "object" || result === null) return [];
  const assertions = (result as { assertions?: unknown }).assertions;
  return Array.isArray(assertions) ? (assertions as AssertionEvaluation[]) : [];
}
const HTTP_METHODS: HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];
const HTTP_METHOD_OPTIONS: SelectOption[] = HTTP_METHODS.map((method) => ({
  label: method,
  value: method,
}));

const HTTP_TABS: NodeModalShellTab[] = [
  { key: "params", label: "Params", icon: Link2 },
  { key: "auth", label: "Auth", icon: KeyRound },
  { key: "headers", label: "Headers", icon: FileText },
  { key: "body", label: "Body", icon: SlidersHorizontal },
  { key: "cookies", label: "Cookies", icon: Cookie },
  { key: "scripts", label: "Scripts", icon: SquareCode },
  { key: "settings", label: "Settings", icon: Settings },
];

const SSE_TABS: NodeModalShellTab[] = [
  { key: "endpoint", label: "Endpoint", icon: Radio },
  { key: "headers", label: "Headers", icon: FileText },
  { key: "finish", label: "Finish", icon: ListChecks },
  { key: "settings", label: "Settings", icon: Settings },
];

const WEBSOCKET_TABS: NodeModalShellTab[] = [
  { key: "endpoint", label: "Endpoint", icon: Radio },
  { key: "headers", label: "Headers", icon: FileText },
  { key: "messages", label: "Messages", icon: SlidersHorizontal },
  { key: "finish", label: "Finish", icon: ListChecks },
  { key: "settings", label: "Settings", icon: Settings },
];

const BROWSER_TABS: NodeModalShellTab[] = [
  { key: "step", label: "Step", icon: MousePointerClick },
  { key: "settings", label: "Settings", icon: Settings },
];

const GRPC_TABS: NodeModalShellTab[] = [
  { key: "endpoint", label: "Endpoint", icon: Waypoints },
  { key: "message", label: "Message", icon: FileText },
  { key: "metadata", label: "Metadata", icon: KeyRound },
  { key: "finish", label: "Finish", icon: SlidersHorizontal },
  { key: "settings", label: "Settings", icon: Settings },
];

const ASSERTION_TABS: NodeModalShellTab[] = [
  { key: "rules", label: "Rules", icon: ListChecks },
  { key: "settings", label: "Settings", icon: Settings },
];

const DELAY_TABS: NodeModalShellTab[] = [
  { key: "duration", label: "Duration", icon: Timer },
  { key: "settings", label: "Settings", icon: Settings },
];

const MERGE_TABS: NodeModalShellTab[] = [
  { key: "strategy", label: "Strategy", icon: GitMerge },
  { key: "conditions", label: "Conditions", icon: Filter },
  { key: "settings", label: "Settings", icon: Settings },
];

function isHttpMethod(value: string): value is HttpMethod {
  return HttpMethodSchema.safeParse(value).success;
}

function getTypeLabel(nodeType: NodeModalNodeType): string {
  if (nodeType === "http-request") return "HTTP Request";
  if (nodeType === "sse") return "SSE Stream";
  if (nodeType === "websocket") return "WebSocket";
  if (nodeType === "grpc") return "gRPC Call";
  if (nodeType === "browser") return "Browser step";
  return nodeType.charAt(0).toUpperCase() + nodeType.slice(1);
}

function formatDelayBadge(duration: number | undefined): string {
  const safeDuration = duration ?? 1000;
  if (safeDuration < 1000) return `~${safeDuration}ms`;
  const seconds = safeDuration / 1000;
  return `~${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
}

/** A fresh draft of `node`: its data, with nothing edited yet. */
function draftFor(node: NodeModalProps["node"]): NodeEditorDraft {
  const working = { current: { ...node.data } as Record<string, unknown> };
  return { nodeId: node.id, working, applied: working.current };
}

function httpConfigFor(node: NodeModalProps["node"]): NodeModalHTTPRequestConfig {
  return normalizeHttpRequestConfig(
    (node.data.config || {}) as NodeModalHTTPRequestConfig,
  );
}

/**
 * The editor. It stays mounted while Previous/Next step from node to node, so
 * the title bar, the tabs and the split between the form and the response do
 * not rebuild (a fresh split lays itself out a frame late, drawing the
 * response over the form). What belongs to one node is keyed by its id in
 * the shell, so each panel there still seeds its state from the node it shows.
 */
function NodeEditor({
  ref,
  nameRef,
  node,
  onClose,
  onSave,
  onSaveWorkflow,
  steps,
  workspaceId,
  currentWorkflowId,
  getNodeOutput,
}: NodeEditorProps) {
  const [draft, setDraft] = useState(() => draftFor(node));
  const [httpConfig, setHttpConfig] = useState(() => httpConfigFor(node));
  // A step hands the editor another node. Start over from it here, during
  // render, not in an effect: an effect runs after the new node's fields
  // have painted once beside the old node's request bar.
  if (draft.nodeId !== node.id) {
    setDraft(draftFor(node));
    setHttpConfig(httpConfigFor(node));
  }
  const workingDataRef = draft.working;
  // Each node type keeps its own tab across steps, so walking a run on
  // Settings stays on Settings.
  const [activeTab, setActiveTab] = useState<NodeModalHttpTabKey>("params");
  const [sseActiveTab, setSseActiveTab] = useState<NodeModalSseTabKey>("endpoint");
  const [websocketActiveTab, setWebsocketActiveTab] =
    useState<NodeModalWebsocketTabKey>("endpoint");
  const [grpcActiveTab, setGrpcActiveTab] = useState<NodeModalGrpcTabKey>("endpoint");
  const [browserActiveTab, setBrowserActiveTab] =
    useState<NodeModalBrowserTabKey>("step");
  const [assertionActiveTab, setAssertionActiveTab] =
    useState<NodeModalAssertionTabKey>("rules");
  const [delayActiveTab, setDelayActiveTab] =
    useState<NodeModalDelayTabKey>("duration");
  const [mergeActiveTab, setMergeActiveTab] =
    useState<NodeModalMergeTabKey>("strategy");

  const applyDraft = () => {
    if (workingDataRef.current === draft.applied) return;
    draft.applied = workingDataRef.current;
    onSave({
      ...node,
      data: workingDataRef.current as unknown as typeof node.data,
    });
  };

  // Escape, an outside click and the close button keep the draft, the way
  // Previous/Next already do; only Cancel throws it away.
  const handleClose = () => {
    applyDraft();
    onClose();
  };

  const handleCancel = () => {
    onClose();
  };

  useImperativeHandle(ref, () => ({ close: handleClose }));

  const handleLabelChange = (newLabel: string) => {
    workingDataRef.current = { ...workingDataRef.current, label: newLabel };
  };

  // Stepping keeps the draft, the way closing does.
  const shellSteps: NodeEditorSteps = {
    ...steps,
    onStep: (direction, target) => {
      applyDraft();
      steps.onStep(direction, target);
    },
  };

  // The save shortcut works inside the editor too, including in its text
  // fields: apply the draft, then run the canvas's normal explicit save.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (matchShortcut(event) !== "save") return;
      event.preventDefault();
      applyDraft();
      onSaveWorkflow();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const updateHttpConfig = (newConfig: NodeModalHTTPRequestConfig) => {
    const normalizedConfig = normalizeHttpRequestConfig(newConfig);
    setHttpConfig(normalizedConfig);
    workingDataRef.current = {
      ...workingDataRef.current,
      config: { ...normalizedConfig },
    };
  };

  const patchHttpConfig = (patch: Partial<NodeModalHTTPRequestConfig>) => {
    updateHttpConfig({ ...httpConfig, ...patch });
  };

  const addExtractor = (variableName: string, responsePath: string) => {
    patchHttpConfig({
      extractors: { ...(httpConfig.extractors ?? {}), [variableName]: responsePath },
    });
  };

  const removeExtractor = (variableName: string) => {
    const extractors = { ...(httpConfig.extractors ?? {}) };
    delete extractors[variableName];
    patchHttpConfig({ extractors });
  };

  const renderHttpRequestBar = () => (
    <div className="flex w-full min-w-0 items-center gap-2">
      <ButtonSelect
        options={HTTP_METHOD_OPTIONS}
        value={httpConfig.method ?? "GET"}
        onChange={(method) => {
          if (isHttpMethod(method)) patchHttpConfig({ method });
        }}
        buttonClass="flex h-10 w-full cursor-pointer items-center justify-between rounded-xs border border-border bg-surface-overlay px-3 font-mono text-xs font-semibold text-text-primary transition-[border-color,outline,background-color] duration-(--aw-transition-fast) ease-in-out hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:outline-offset-(--aw-focus-ring-offset) dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-primary-dark dark:hover:bg-surface-dark-raised"
        containerClass="w-28 shrink-0"
      />
      <TemplateInput
        value={httpConfig.url || ""}
        onValueChange={(url) => patchHttpConfig({ url })}
        placeholder="https://api.example.com/{{variables.resourceId}}"
        aria-label="Request URL"
        className="font-mono"
      />
    </div>
  );

  const renderTypeBar = () => {
    const config = node.data.config || {};
    const assertionConfig = config as Partial<NodeModalAssertionConfig>;
    const delayConfig = config as Partial<NodeModalDelayConfig>;
    const mergeConfig = config as Partial<NodeModalMergeConfig>;
    const workflowCallConfig = config as Partial<NodeModalWorkflowCallConfig>;

    return (
      <div className="flex w-full min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="secondary" size="sm">
            Type: {getTypeLabel(node.type)}
          </Badge>
          {node.type === "assertion" && (
            <Tooltip content="Number of assertion rules configured for this node.">
              <Badge variant="info" size="sm">
                <CheckCircle2 className="h-3 w-3" />
                {assertionConfig.assertions?.length ?? 0} rules
              </Badge>
            </Tooltip>
          )}
          {node.type === "delay" && (
            <Tooltip content="Configured pause duration before the workflow continues.">
              <Badge
                variant="outline"
                size="sm"
                className="border-status-running/30 bg-status-running/10 text-status-running dark:border-(--aw-status-running)/30 dark:bg-(--aw-status-running)/10 dark:text-(--aw-status-running)"
              >
                <Timer className="h-3 w-3" />
                {formatDelayBadge(delayConfig.duration)}
              </Badge>
            </Tooltip>
          )}
          {node.type === "merge" && (
            <Tooltip content="Merge strategy used to synchronize incoming branches.">
              <Badge variant="success" size="sm">
                <GitMerge className="h-3 w-3" />
                Strategy: {mergeConfig.mergeStrategy ?? "all"}
              </Badge>
            </Tooltip>
          )}
          {node.type === "workflow" && (
            <Tooltip content="The workflow this node runs as a single step.">
              <Badge variant={workflowCallConfig.targetWorkflowId ? "info" : "outline"} size="sm">
                {workflowCallConfig.targetWorkflowName ??
                  workflowCallConfig.targetWorkflowId ??
                  "No target"}
              </Badge>
            </Tooltip>
          )}
          <span className="truncate text-sm font-semibold text-text-primary dark:text-text-primary-dark">
            {node.data.label}
          </span>
        </div>
      </div>
    );
  };

  const renderConfigPanel = () => {
    if (node.type === "http-request") {
      return (
        <HTTPRequestConfigPanel
          initialConfig={
            (node.data.config || EMPTY_CONFIG) as NodeModalHTTPRequestConfig
          }
          workingDataRef={workingDataRef}
          activeTab={activeTab}
          config={httpConfig}
          onConfigChange={updateHttpConfig}
          lastResult={
            (node.data?.executionResult as Record<string, unknown> | null) ||
            null
          }
        />
      );
    }

    if (node.type === "sse") {
      return (
        <SseConfigPanel
          initialConfig={node.data.config as Partial<NodeModalSseConfig>}
          workingDataRef={workingDataRef}
          activeTab={sseActiveTab}
        />
      );
    }

    if (node.type === "websocket") {
      return (
        <WebsocketConfigPanel
          initialConfig={(node.data.config || EMPTY_CONFIG) as Partial<NodeModalWebsocketConfig>}
          workingDataRef={workingDataRef}
          activeTab={websocketActiveTab}
        />
      );
    }

    if (node.type === "grpc") {
      return (
        <GrpcConfigPanel
          initialConfig={(node.data.config || EMPTY_CONFIG) as Partial<NodeModalGrpcConfig>}
          workingDataRef={workingDataRef}
          activeTab={grpcActiveTab}
        />
      );
    }

    if (node.type === "browser") {
      return (
        <BrowserConfigPanel
          initialConfig={node.data.config || EMPTY_CONFIG}
          workingDataRef={workingDataRef}
          activeTab={browserActiveTab}
        />
      );
    }

    if (node.type === "assertion") {
      return (
        <AssertionConfigPanel
          initialConfig={
            (node.data.config || {}) as Partial<NodeModalAssertionConfig>
          }
          workingDataRef={workingDataRef}
          activeTab={assertionActiveTab}
        />
      );
    }

    if (node.type === "delay") {
      return (
        <DelayConfigPanel
          initialConfig={
            (node.data.config || {}) as Partial<NodeModalDelayConfig>
          }
          workingDataRef={workingDataRef}
          activeTab={delayActiveTab}
        />
      );
    }

    if (node.type === "merge") {
      return (
        <MergeConfigPanel
          initialConfig={
            (node.data.config || {}) as Partial<NodeModalMergeConfig>
          }
          workingDataRef={workingDataRef}
          activeTab={mergeActiveTab}
        />
      );
    }

    if (node.type === "workflow") {
      return (
        <WorkflowCallConfigPanel
          initialConfig={
            (node.data.config || {}) as Partial<NodeModalWorkflowCallConfig>
          }
          workingDataRef={workingDataRef}
          workspaceId={workspaceId}
          currentWorkflowId={currentWorkflowId}
        />
      );
    }

    if (NO_CONFIG_TYPES.includes(node.type)) {
      return (
        <div className="rounded-xs border border-dashed border-border bg-surface-overlay p-6 text-sm text-text-secondary dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-secondary-dark">
          No configuration needed for {node.type} nodes.
        </div>
      );
    }

    return null;
  };

  // The canvas stores a node's result loosely; the browser pane reads its own
  // shape, so confirm it is a record before handing it over.
  const browserOutput: BrowserOutputPanelProps["output"] =
    typeof node.data.executionResult === "object" &&
    node.data.executionResult !== null
      ? (node.data.executionResult as BrowserOutputPanelProps["output"])
      : null;

  const responsePane =
    node.type === "http-request" ? (
      <HttpRequestOutputPanel
        node={node}
        initialConfig={httpConfig}
        output={
          (node.data?.executionResult as Record<string, unknown> | null) || null
        }
        extractors={httpConfig.extractors ?? {}}
        onAddExtractor={addExtractor}
        onRemoveExtractor={removeExtractor}
      />
    ) : node.type === "browser" ? (
      <BrowserOutputPanel
        output={browserOutput}
        executionStatus={node.data.executionStatus}
        workspaceId={workspaceId}
      />
    ) : (
      <NodeOutputPanel
        output={node.data?.executionResult ?? null}
        executionStatus={node.data.executionStatus}
        {...(node.type === "assertion"
          ? {
              review: (
                <SnapshotReview
                  nodeId={node.id}
                  assertions={assertionEvaluations(node.data?.executionResult)}
                  // An Assertion node's rule read another node's result: accept that value.
                  readActual={(rule) =>
                    rule.sourceNodeId === null
                      ? undefined
                      : readSnapshotActual(getNodeOutput(rule.sourceNodeId), rule)
                  }
                  showDifferences
                />
              ),
            }
          : {})}
      />
    );

  const extractorCount = Object.keys(httpConfig.extractors ?? {}).length;
  const httpTabs =
    extractorCount > 0
      ? HTTP_TABS.map((tab) =>
          tab.key === "settings" ? { ...tab, badge: extractorCount } : tab,
        )
      : HTTP_TABS;

  const shellTabs =
    node.type === "http-request"
      ? httpTabs
      : node.type === "sse"
        ? SSE_TABS
      : node.type === "websocket"
        ? WEBSOCKET_TABS
      : node.type === "grpc"
        ? GRPC_TABS
      : node.type === "browser"
        ? BROWSER_TABS
      : node.type === "assertion"
        ? ASSERTION_TABS
        : node.type === "delay"
          ? DELAY_TABS
          : node.type === "merge"
            ? MERGE_TABS
            : [];
  const shellActiveTab =
    node.type === "http-request"
      ? activeTab
      : node.type === "sse"
        ? sseActiveTab
      : node.type === "websocket"
        ? websocketActiveTab
      : node.type === "grpc"
        ? grpcActiveTab
      : node.type === "browser"
        ? browserActiveTab
      : node.type === "assertion"
        ? assertionActiveTab
        : node.type === "delay"
          ? delayActiveTab
          : node.type === "merge"
            ? mergeActiveTab
            : "";

  return (
    <NodeModalShell
      nodeId={node.id}
      nodeType={node.type}
      nodeLabel={node.data.label || ""}
      tabs={shellTabs}
      activeTab={shellActiveTab}
      onTabChange={(tabKey) => {
        if (isHttpMethod(tabKey)) return;
        if (node.type === "http-request")
          setActiveTab(tabKey as NodeModalHttpTabKey);
        if (node.type === "sse") setSseActiveTab(tabKey as NodeModalSseTabKey);
        if (node.type === "websocket")
          setWebsocketActiveTab(tabKey as NodeModalWebsocketTabKey);
        if (node.type === "grpc") setGrpcActiveTab(tabKey as NodeModalGrpcTabKey);
        if (node.type === "browser")
          setBrowserActiveTab(tabKey as NodeModalBrowserTabKey);
        if (node.type === "assertion")
          setAssertionActiveTab(tabKey as NodeModalAssertionTabKey);
        if (node.type === "delay")
          setDelayActiveTab(tabKey as NodeModalDelayTabKey);
        if (node.type === "merge")
          setMergeActiveTab(tabKey as NodeModalMergeTabKey);
      }}
      onLabelChange={handleLabelChange}
      onClose={handleClose}
      onCancel={handleCancel}
      onSave={handleClose}
      steps={shellSteps}
      nameRef={nameRef}
      requestBar={
        node.type === "http-request" ? renderHttpRequestBar() : renderTypeBar()
      }
      responsePane={responsePane}
    >
      {renderConfigPanel()}
    </NodeModalShell>
  );
}

/**
 * The node editor's dialog. It stays open while the editor steps from node to
 * node, so a step does not replay the dialog's open transition or flash the
 * backdrop.
 */
export function NodeModal({ open, ...editor }: NodeModalProps) {
  const editorRef = useRef<NodeEditorHandle | null>(null);
  const nameLabelRef = useRef<HTMLElement | null>(null);

  return (
    <Modal
      isOpen={open}
      onClose={() => editorRef.current?.close()}
      title=""
      size="fullscreen"
      scrollable={false}
      showClose={false}
      initialFocus={nameLabelRef}
      className="max-w-[1800px]! rounded-xs! shadow-(--aw-shadow-modal)!"
    >
      <NodeEditor
        ref={editorRef}
        nameRef={nameLabelRef}
        {...editor}
      />
    </Modal>
  );
}

export default NodeModal;
