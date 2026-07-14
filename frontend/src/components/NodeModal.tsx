import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Cookie,
  FileText,
  Filter,
  GitMerge,
  KeyRound,
  Link2,
  ListChecks,
  Settings,
  SlidersHorizontal,
  Timer,
} from "lucide-react";
import { Badge } from "./atoms/Badge";
import { Input } from "./atoms/Input";
import { Tooltip } from "./atoms/Tooltip";
import ButtonSelect from "./ButtonSelect";
import {
  HTTPRequestConfigPanel,
  HttpRequestOutputPanel,
  NodeOutputPanel,
  AssertionConfigPanel,
  DelayConfigPanel,
  MergeConfigPanel,
  NodeModalShell,
} from "./node-modal";
import { normalizeHttpRequestConfig } from "./node-modal/httpRequestConfigCompat";
import type { HttpMethod } from "../types/HttpMethod";
import type { NodeModalProps } from "../types/NodeModalProps";
import type { NodeModalNodeType } from "../types/NodeModalNodeType";
import type { NodeModalHTTPRequestConfig } from "../types/NodeModalHTTPRequestConfig";
import type { NodeModalMergeConfig } from "../types/NodeModalMergeConfig";
import type {
  NodeModalAssertionConfig,
  NodeModalAssertionTabKey,
  NodeModalDelayConfig,
  NodeModalDelayTabKey,
  NodeModalHttpTabKey,
  NodeModalMergeTabKey,
  NodeModalShellTab,
  SelectOption,
} from "../types";

const NO_CONFIG_TYPES: NodeModalNodeType[] = ["start", "end"];
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
  return HTTP_METHODS.includes(value as HttpMethod);
}

function getTypeLabel(nodeType: NodeModalNodeType): string {
  if (nodeType === "http-request") return "HTTP Request";
  return nodeType.charAt(0).toUpperCase() + nodeType.slice(1);
}

function formatDelayBadge(duration: number | undefined): string {
  const safeDuration = duration ?? 1000;
  if (safeDuration < 1000) return `~${safeDuration}ms`;
  const seconds = safeDuration / 1000;
  return `~${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
}

export function NodeModal({ open, node, onClose, onSave }: NodeModalProps) {
  const workingDataRef = useRef<Record<string, unknown>>({ ...node.data });
  const nameLabelRef = useRef<HTMLElement | null>(null);
  const [activeTab, setActiveTab] = useState<NodeModalHttpTabKey>("params");
  const [assertionActiveTab, setAssertionActiveTab] =
    useState<NodeModalAssertionTabKey>("rules");
  const [delayActiveTab, setDelayActiveTab] =
    useState<NodeModalDelayTabKey>("duration");
  const [mergeActiveTab, setMergeActiveTab] =
    useState<NodeModalMergeTabKey>("strategy");
  const [httpConfig, setHttpConfig] = useState<NodeModalHTTPRequestConfig>(() =>
    normalizeHttpRequestConfig(
      (node.data.config || {}) as NodeModalHTTPRequestConfig,
    ),
  );

  useEffect(() => {
    if (!open) return;
    workingDataRef.current = { ...node.data };
    setActiveTab("params");
    setAssertionActiveTab("rules");
    setDelayActiveTab("duration");
    setMergeActiveTab("strategy");
    setHttpConfig(
      normalizeHttpRequestConfig(
        (node.data.config || {}) as NodeModalHTTPRequestConfig,
      ),
    );
  }, [node, open]);

  const handleClose = () => {
    onClose();
  };

  const handleSave = () => {
    onSave({
      ...node,
      data: workingDataRef.current as unknown as typeof node.data,
    });
    handleClose();
  };

  const handleLabelChange = (newLabel: string) => {
    workingDataRef.current = { ...workingDataRef.current, label: newLabel };
  };

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

  const renderHttpRequestBar = () => (
    <div className="flex w-full min-w-0 items-center gap-2">
      <ButtonSelect
        options={HTTP_METHOD_OPTIONS}
        value={httpConfig.method ?? "GET"}
        onChange={(method) => {
          if (isHttpMethod(method)) patchHttpConfig({ method });
        }}
        buttonClass="flex h-10 w-full cursor-pointer items-center justify-between rounded-sm border border-border bg-surface-overlay px-3 font-mono text-xs font-semibold text-text-primary transition-[border-color,outline,background-color] duration-[var(--aw-transition-fast)] ease-in-out hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-primary-dark dark:hover:bg-surface-dark-raised"
        containerClass="w-28 flex-shrink-0"
      />
      <Input
        value={httpConfig.url || ""}
        onChange={(event) => patchHttpConfig({ url: event.target.value })}
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
                className="border-status-running/30 bg-status-running/10 text-status-running dark:border-[var(--aw-status-running)]/30 dark:bg-[var(--aw-status-running)]/10 dark:text-[var(--aw-status-running)]"
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
          initialConfig={(node.data.config || {}) as NodeModalHTTPRequestConfig}
          workingDataRef={workingDataRef}
          activeTab={activeTab}
          config={httpConfig}
          onConfigChange={updateHttpConfig}
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

    if (NO_CONFIG_TYPES.includes(node.type)) {
      return (
        <div className="rounded-sm border border-dashed border-border bg-surface-overlay p-6 text-sm text-text-muted dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-muted-dark">
          No configuration needed for {node.type} nodes.
        </div>
      );
    }

    return null;
  };

  const responsePane =
    node.type === "http-request" ? (
      <HttpRequestOutputPanel
        node={node}
        initialConfig={httpConfig}
        output={
          (node.data?.executionResult as Record<string, unknown> | null) || null
        }
      />
    ) : (
      <NodeOutputPanel
        output={node.data?.executionResult ?? null}
        executionStatus={node.data.executionStatus}
      />
    );

  const shellTabs =
    node.type === "http-request"
      ? HTTP_TABS
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
      : node.type === "assertion"
        ? assertionActiveTab
        : node.type === "delay"
          ? delayActiveTab
          : node.type === "merge"
            ? mergeActiveTab
            : "";

  return (
    <NodeModalShell
      open={open}
      nodeType={node.type}
      nodeLabel={node.data.label || ""}
      tabs={shellTabs}
      activeTab={shellActiveTab}
      onTabChange={(tabKey) => {
        if (isHttpMethod(tabKey)) return;
        if (node.type === "http-request")
          setActiveTab(tabKey as NodeModalHttpTabKey);
        if (node.type === "assertion")
          setAssertionActiveTab(tabKey as NodeModalAssertionTabKey);
        if (node.type === "delay")
          setDelayActiveTab(tabKey as NodeModalDelayTabKey);
        if (node.type === "merge")
          setMergeActiveTab(tabKey as NodeModalMergeTabKey);
      }}
      onLabelChange={handleLabelChange}
      onClose={handleClose}
      onCancel={handleClose}
      onSave={handleSave}
      initialFocus={nameLabelRef}
      requestBar={
        node.type === "http-request" ? renderHttpRequestBar() : renderTypeBar()
      }
      responsePane={responsePane}
    >
      {renderConfigPanel()}
    </NodeModalShell>
  );
}

export default NodeModal;
