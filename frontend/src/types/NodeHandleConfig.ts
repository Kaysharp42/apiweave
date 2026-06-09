import type { CSSProperties } from 'react';

export interface NodeHandleConfig {
  type?: 'source' | 'target';
  id?: string;
  style?: CSSProperties;
}
