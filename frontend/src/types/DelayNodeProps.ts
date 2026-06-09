import type { DelayNodeData } from './DelayNodeData';

export type { DelayNodeData } from './DelayNodeData';

export interface DelayNodeProps {
  id: string;
  data: DelayNodeData;
  selected?: boolean;
}
