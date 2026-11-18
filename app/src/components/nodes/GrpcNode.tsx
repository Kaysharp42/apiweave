import { memo, useEffect, useMemo } from "react";
import { useUpdateNodeInternals } from "@xyflow/react";
import { Waypoints } from "lucide-react";
import { BaseNode } from "../atoms/flow/BaseNode";
import { STREAM_NODE_HANDLES } from "../atoms/flow/StreamOutputHandle";
import { formatDuration } from "../../utils/formatNodeMetrics";
import type { BaseNodeProps } from "../../types/BaseNodeProps";
import type { GrpcCallType } from "../../types/GrpcCallType";
import type { GrpcNodeProps } from "../../types/GrpcNodeProps";

/**
 * A server-streaming call's `ready` and `complete` outputs, or a single unnamed
 * output for any other call type.
 */
function useGrpcHandles(
  id: string,
  callType: GrpcCallType | undefined,
): Pick<BaseNodeProps, "handleLeft" | "handleRight" | "extraHandles"> {
  const streaming = callType === "server-streaming";
  // ReactFlow measures a node's sockets once and draws edges against that
  // measurement. Switching the call type swaps one unnamed output for `ready`
  // and `complete` (or back), so the node is re-measured, or an edge rewired to
  // a new socket stays undrawn until the workflow is reopened.
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, streaming, updateNodeInternals]);
  return streaming ? STREAM_NODE_HANDLES : { handleLeft: { type: "target" }, handleRight: { type: "source" } };
}

function GrpcNode({ id, data, selected }: GrpcNodeProps) {
  const { target, service, method, expectedStatus, callType } = data.config ?? {};
  const handles = useGrpcHandles(id, callType);
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
      {...handles}
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
