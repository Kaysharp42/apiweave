import type { NodeModalAssertionConfig } from './NodeModalAssertionConfig';
import type { NodeModalAssertionTabKey } from './NodeModalAssertionTabKey';

export interface AssertionConfigPanelProps {
  initialConfig: Partial<NodeModalAssertionConfig>;
  workingDataRef: React.MutableRefObject<Record<string, unknown>>;
  activeTab?: NodeModalAssertionTabKey;
}
