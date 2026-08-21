import type { LucideIcon } from "lucide-react";

/** One row in a right-click menu. */
export interface ContextMenuItem {
  readonly key: string;
  readonly icon: LucideIcon;
  readonly label: string;
  /** Rendered with a divider above it — groups actions without a separate item type. */
  readonly separated?: boolean;
  /** Red text and hover, for a delete. */
  readonly destructive?: boolean;
  readonly onSelect: () => void;
}
