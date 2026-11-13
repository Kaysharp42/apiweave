import type { WebsocketNodeData } from "./WebsocketNodeData";

export interface WebsocketNodeProps {
  id: string;
  data: WebsocketNodeData;
  selected?: boolean;
}
