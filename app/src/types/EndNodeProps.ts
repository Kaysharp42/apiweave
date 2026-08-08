import type { TerminalNodeData } from "./TerminalNodeData";

export interface EndNodeProps {
  id: string;
  data?: TerminalNodeData;
  selected?: boolean;
}
