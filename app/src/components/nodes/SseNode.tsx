import { memo, useMemo } from "react";
import { Radio } from "lucide-react";
import { BaseNode } from "../atoms/flow/BaseNode";
import { StreamOutputHandle } from "../atoms/flow/StreamOutputHandle";
import { formatDuration } from "../../utils/formatNodeMetrics";
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
      handleLeft={{ type: "target" }}
      handleRight={{ type: "source", id: "ready", style: { top: "calc(50% - 10px)" } }}
      extraHandles={<StreamOutputHandle id="complete" label="complete" offsetY={10} />}
      collapsible={false}
      typeChip={<span className="rounded-node-chip bg-status-info/10 px-1.5 py-0.5 font-mono text-2xs text-status-info">SSE</span>}
      restLine={{ operation: finishRuleCount > 0 ? "until match" : "collect", argument: finishRuleCount > 0 ? `${finishRuleCount} finish rule${finishRuleCount === 1 ? "" : "s"}` : `${maxEvents} event${maxEvents === 1 ? "" : "s"}` }}
      activityLine={{ operation: "listening", ...(eventType ? { argument: eventType } : {}) }}
      {...(eventCount === undefined ? {} : { resultSummary: { operation: "received", argument: `${eventCount} event${eventCount === 1 ? "" : "s"}` } })}
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
