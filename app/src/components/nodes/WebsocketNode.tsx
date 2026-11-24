import { memo, useMemo } from "react";
import { Cable } from "lucide-react";
import { BaseNode } from "../atoms/flow/BaseNode";
import { STREAM_NODE_HANDLES } from "../atoms/flow/StreamOutputHandle";
import { formatCount, formatDuration, formatStreamRestLine } from "../../utils/formatNodeMetrics";
import type { WebsocketNodeProps } from "../../types/WebsocketNodeProps";

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
      {...STREAM_NODE_HANDLES}
      collapsible={false}
      typeChip={<span className="rounded-node-chip bg-status-info/10 px-1.5 py-0.5 font-mono text-2xs text-status-info">WS</span>}
      restLine={formatStreamRestLine(finishRuleCount, maxMessages, "message")}
      activityLine={{ operation: "listening" }}
      {...(messageCount === undefined ? {} : { resultSummary: { operation: "received", argument: formatCount(messageCount, "message") } })}
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
