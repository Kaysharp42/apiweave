import { memo, useMemo } from "react";
import { Cable } from "lucide-react";
import { BaseNode } from "../atoms/flow/BaseNode";
import { NodeHandle } from "../atoms/flow/NodeHandle";
import { formatDuration } from "../../utils/formatNodeMetrics";
import type { WebsocketNodeProps } from "../../types/WebsocketNodeProps";

function WebsocketOutputHandle({ id, label, offsetY }: { id: "ready" | "complete"; label: string; offsetY: number }) {
  return (
    <div className="group absolute" style={{ top: "50%", right: 0, transform: `translateY(${offsetY}px)` }}>
      <NodeHandle type="source" position="right" id={id} style={{ position: "relative" }} />
      <span className="pointer-events-none absolute right-3 top-[-5px] whitespace-nowrap text-2xs font-semibold uppercase tracking-wide text-text-secondary opacity-0 transition-opacity group-hover:opacity-100 dark:text-text-secondary-dark">
        {label}
      </span>
    </div>
  );
}

// fallow-ignore-next-line complexity -- this presentational node derives labels and optional display slots directly from stream configuration; moving those branches to helpers would not simplify the rendered contract.
function WebsocketNode({ id, data, selected }: WebsocketNodeProps) {
  const maxMessages = data.config?.maxMessages ?? 1;
  const finishRuleCount = data.config?.finishConditions?.length ?? 0;
  const messageCount = data.executionResult?.body?.messageCount;
  const status = data.executionStatus ?? "idle";
  const icon = useMemo(() => <Cable className="h-4 w-4" />, []);

  return (
    <BaseNode
      title={data.label ?? "WebSocket"}
      icon={icon}
      tileHue="var(--aw-status-info)"
      status={status}
      selected={selected ?? false}
      nodeId={id}
      presetNodeType="websocket"
      handleLeft={{ type: "target" }}
      handleRight={{ type: "source", id: "ready", style: { top: "calc(50% - 10px)" } }}
      extraHandles={<WebsocketOutputHandle id="complete" label="complete" offsetY={10} />}
      collapsible={false}
      typeChip={<span className="rounded-node-chip bg-status-info/10 px-1.5 py-0.5 font-mono text-2xs text-status-info">WS</span>}
      restLine={{ operation: finishRuleCount > 0 ? "until match" : "collect", argument: finishRuleCount > 0 ? `${finishRuleCount} finish rule${finishRuleCount === 1 ? "" : "s"}` : `${maxMessages} message${maxMessages === 1 ? "" : "s"}` }}
      activityLine={{ operation: "listening" }}
      {...(messageCount === undefined ? {} : { resultSummary: { operation: "received", argument: `${messageCount} message${messageCount === 1 ? "" : "s"}` } })}
      metrics={[
        { label: "messages", value: messageCount === undefined ? null : String(messageCount) },
        { label: "duration", value: formatDuration(data.executionResult?.duration) },
      ]}
      progress={status === "running" ? "indeterminate" : null}
      className="min-w-node-compact"
    />
  );
}

export default memo(WebsocketNode);
