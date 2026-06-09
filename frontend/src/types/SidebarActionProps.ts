import type { ElementType } from 'react';

export interface SidebarActionProps {
  /** Lucide icon component */
  icon: ElementType;
  /** Accessible label for the button */
  label: string;
  /** Click handler */
  onClick: (event: React.MouseEvent) => void;
  /** Whether this is a destructive action (delete, etc.) */
  destructive?: boolean;
  /** Additional CSS classes */
  className?: string;
}