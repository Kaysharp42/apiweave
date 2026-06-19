import type { ReactNode } from 'react';
import type { NavSection } from './NavSection';

export interface WorkspacePageShellProps {
  children: ReactNode;
  navState?: NavSection;
}
