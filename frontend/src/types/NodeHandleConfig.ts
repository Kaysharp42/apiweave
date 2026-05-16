export interface NodeHandleConfig {
  type: 'source' | 'target';
  id?: string;
  position?: 'left' | 'right' | 'top' | 'bottom';
  style?: React.CSSProperties;
}
