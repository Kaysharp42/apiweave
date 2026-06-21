import type { NodeModalMergeConfig } from "./NodeModalMergeConfig";
import type { NodeModalMergeTabKey } from "./NodeModalMergeTabKey";

export interface MergeConfigPanelProps {
  initialConfig: Partial<NodeModalMergeConfig>;
  workingDataRef: React.MutableRefObject<Record<string, unknown>>;
  activeTab?: NodeModalMergeTabKey;
}
