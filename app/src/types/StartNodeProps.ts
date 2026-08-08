import type { TerminalNodeData } from "./TerminalNodeData";

export interface StartNodeProps {
  id: string;
  data?: TerminalNodeData;
  selected?: boolean;
}
