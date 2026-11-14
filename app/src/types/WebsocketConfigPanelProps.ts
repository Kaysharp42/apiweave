import type { NodeModalWebsocketConfig } from "./NodeModalWebsocketConfig";
import type { NodeModalWebsocketTabKey } from "./NodeModalWebsocketTabKey";

export interface WebsocketConfigPanelProps {
  initialConfig: Partial<NodeModalWebsocketConfig>;
  workingDataRef: React.MutableRefObject<Record<string, unknown>>;
  activeTab: NodeModalWebsocketTabKey;
}
