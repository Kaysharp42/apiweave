import { memo } from "react";
import {
  TerminalNode,
  TERMINAL_NODE_PRESETS,
} from "../atoms/flow/TerminalNode";
import type { EndNodeProps } from "../../types/EndNodeProps";

const EndNode = ({ id, data, selected }: EndNodeProps) => (
  <TerminalNode
    nodeId={id}
    selected={selected ?? false}
    status={data?.executionStatus ?? "idle"}
    {...TERMINAL_NODE_PRESETS.end}
  />
);

export default memo(EndNode);
