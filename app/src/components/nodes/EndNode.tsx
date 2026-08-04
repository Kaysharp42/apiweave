import { memo } from "react";
import {
  TerminalNode,
  TERMINAL_NODE_PRESETS,
} from "../atoms/flow/TerminalNode";
import type { EndNodeProps } from "../../types/EndNodeProps";

const EndNode = ({ id, selected }: EndNodeProps) => (
  <TerminalNode
    nodeId={id}
    selected={selected ?? false}
    {...TERMINAL_NODE_PRESETS.end}
  />
);

export default memo(EndNode);
