import { memo } from "react";
import {
  TerminalNode,
  TERMINAL_NODE_PRESETS,
} from "../atoms/flow/TerminalNode";
import type { StartNodeProps } from "../../types/StartNodeProps";

const StartNode = ({ id, data, selected }: StartNodeProps) => (
  <TerminalNode
    nodeId={id}
    selected={selected ?? false}
    status={data?.executionStatus ?? "idle"}
    {...TERMINAL_NODE_PRESETS.start}
  />
);

export default memo(StartNode);
