import type { ReactNode } from 'react';

export interface NodeModalResponsePaneProps {
  children: ReactNode;
  title?: string;
  onHide?: () => void;
}
