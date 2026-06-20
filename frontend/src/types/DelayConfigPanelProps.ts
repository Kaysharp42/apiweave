import type { NodeModalDelayConfig } from './NodeModalDelayConfig';
import type { NodeModalDelayTabKey } from './NodeModalDelayTabKey';

export interface DelayConfigPanelProps {
  initialConfig: Partial<NodeModalDelayConfig>;
  workingDataRef: React.MutableRefObject<Record<string, unknown>>;
  activeTab?: NodeModalDelayTabKey;
}
