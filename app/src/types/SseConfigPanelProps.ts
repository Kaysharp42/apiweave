import type { NodeModalSseConfig } from "./NodeModalSseConfig";
import type { NodeModalSseTabKey } from "./NodeModalSseTabKey";

export interface SseConfigPanelProps {
  initialConfig: Partial<NodeModalSseConfig>;
  workingDataRef: React.MutableRefObject<Record<string, unknown>>;
  activeTab: NodeModalSseTabKey;
}
