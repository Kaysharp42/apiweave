import type { NodeModalMergeConfig } from './NodeModalMergeConfig';

export interface MergeConfigPanelProps {
  initialConfig: NodeModalMergeConfig;
  workingDataRef: React.MutableRefObject<Record<string, unknown>>;
}