import { memo } from "react";
import {
  TerminalNode,
  TERMINAL_NODE_PRESETS,
} from "../atoms/flow/TerminalNode";
import type { StartNodeProps } from "../../types/StartNodeProps";

const StartNode = ({ id, selected }: StartNodeProps) => (
  <TerminalNode
    nodeId={id}
    selected={selected ?? false}
    {...TERMINAL_NODE_PRESETS.start}
  />
);

export default memo(StartNode);
