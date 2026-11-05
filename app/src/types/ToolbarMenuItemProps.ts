import type { LucideIcon } from "lucide-react";

/** One row shared by the toolbar's menus: icon, label, optional chord hint. */
export interface ToolbarMenuItemProps {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly shortcut?: string | undefined;
  readonly hint?: string | undefined;
  readonly title?: string | undefined;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
}
