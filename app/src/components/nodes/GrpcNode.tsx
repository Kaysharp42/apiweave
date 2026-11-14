import { memo, useMemo } from "react";
import { Waypoints } from "lucide-react";
import { BaseNode } from "../atoms/flow/BaseNode";
import { formatDuration } from "../../utils/formatNodeMetrics";
import type { GrpcNodeProps } from "../../types/GrpcNodeProps";

function GrpcNode({ id, data, selected }: GrpcNodeProps) {
  const { target, service, method, expectedStatus } = data.config ?? {};
  const status = data.executionStatus ?? "idle";
  const grpcStatus = data.executionResult?.response?.status;
  const icon = useMemo(() => <Waypoints className="h-4 w-4" />, []);
  const call = service && method ? `${service.split(".").at(-1)}/${method}` : "no method chosen";

  return (
    <BaseNode
      title={data.label ?? "gRPC Call"}
      icon={icon}
      tileHue="var(--aw-status-info)"
      status={status}
      selected={selected ?? false}
      nodeId={id}
      presetNodeType="grpc"
      handleLeft={{ type: "target" }}
      handleRight={{ type: "source" }}
      collapsible={false}
      typeChip={<span className="rounded-node-chip bg-status-info/10 px-1.5 py-0.5 font-mono text-2xs text-status-info">gRPC</span>}
      restLine={{ operation: call, ...(target ? { argument: target } : {}) }}
      activityLine={{ operation: "calling", argument: call }}
      {...(grpcStatus === undefined ? {} : { resultSummary: { operation: "returned", argument: grpcStatus } })}
      metrics={[
        { label: "status", value: grpcStatus ?? (expectedStatus ? `expects ${expectedStatus}` : null) },
        { label: "duration", value: formatDuration(data.executionResult?.duration) },
      ]}
      progress={status === "running" ? "indeterminate" : null}
      className="min-w-node-compact"
    />
  );
}

export default memo(GrpcNode);
