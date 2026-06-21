import type { ReactNode } from "react";

export interface SidebarItemProps {
  /** Whether this item is currently active/selected */
  isActive: boolean;
  /** Content rendered as the main clickable area */
  children: ReactNode;
  /** Action buttons rendered on the right side (visible on hover/focus) */
  actions?: ReactNode;
  /** Additional CSS classes */
  className?: string;
}
