import type { LucideIcon } from "lucide-react";

export interface SidebarListEmptyStateProps {
  readonly icon: LucideIcon;
  /** What the list holds, in the plural and lower case: "projects". */
  readonly items: string;
  /** Shown when nothing is filtered out and the list is simply empty. */
  readonly emptyDescription: string;
  readonly createLabel: string;
  readonly searchQuery: string;
  readonly onCreate: () => void;
}
