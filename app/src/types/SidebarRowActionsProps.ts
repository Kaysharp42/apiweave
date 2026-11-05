import type { ReactNode } from "react";

export interface SidebarRowActionsProps {
  readonly children: ReactNode;
  /** True when the owning row is selected, so the fade blends with its tint. */
  readonly active?: boolean;
}
