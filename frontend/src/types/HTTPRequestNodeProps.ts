import type { HTTPRequestNodeData } from './HTTPRequestNodeData';

export type { SchemaWarning } from './SchemaWarning';
export type { HTTPRequestNodeData } from './HTTPRequestNodeData';

export interface HTTPRequestNodeProps {
  id: string;
  data: HTTPRequestNodeData;
  selected?: boolean;
}
