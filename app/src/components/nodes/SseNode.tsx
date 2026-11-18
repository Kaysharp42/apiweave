import { memo, useMemo } from "react";
import { Radio } from "lucide-react";
import { BaseNode } from "../atoms/flow/BaseNode";
import { STREAM_NODE_HANDLES } from "../atoms/flow/StreamOutputHandle";
import { formatCount, formatDuration, formatStreamRestLine } from "../../utils/formatNodeMetrics";
import type { SseNodeProps } from "../../types/SseNodeProps";

// fallow-ignore-next-line complexity -- this presentational node derives labels and optional display slots directly from stream configuration; moving those branches to helpers would not simplify the rendered contract.
function SseNode({ id, data, selected }: SseNodeProps) {
  const maxEvents = data.config?.maxEvents ?? 1;
  const eventType = data.config?.eventType;
  const finishRuleCount = data.config?.finishConditions?.length ?? 0;
  const eventCount = data.executionResult?.body?.eventCount;
  const status = data.executionStatus ?? "idle";
  const icon = useMemo(() => <Radio className="h-4 w-4" />, []);

  return (
    <BaseNode
      title={data.label ?? "SSE Stream"}
      icon={icon}
      tileHue="var(--aw-status-info)"
      status={status}
      selected={selected ?? false}
      nodeId={id}
      presetNodeType="sse"
      {...STREAM_NODE_HANDLES}
      collapsible={false}
      typeChip={<span className="rounded-node-chip bg-status-info/10 px-1.5 py-0.5 font-mono text-2xs text-status-info">SSE</span>}
      restLine={formatStreamRestLine(finishRuleCount, maxEvents, "event")}
      activityLine={{ operation: "listening", ...(eventType ? { argument: eventType } : {}) }}
      {...(eventCount === undefined ? {} : { resultSummary: { operation: "received", argument: formatCount(eventCount, "event") } })}
      metrics={[
        { label: "events", value: eventCount === undefined ? null : String(eventCount) },
        { label: "duration", value: formatDuration(data.executionResult?.duration) },
      ]}
      progress={status === "running" ? "indeterminate" : null}
      className="min-w-node-compact"
    />
  );
}

export default memo(SseNode);
