import type { SseNodeData } from "./SseNodeData";

export interface SseNodeProps {
  id: string;
  data: SseNodeData;
  selected?: boolean;
}
