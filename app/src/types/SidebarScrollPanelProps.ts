import type { ReactNode } from "react";

/** One sidebar list panel's scroll region, shown for its own nav tab. */
export interface SidebarScrollPanelProps {
  /** True while another nav tab owns the sidebar, so this panel is hidden but kept mounted. */
  readonly hidden: boolean;
  /** A refresh is under way, so the list is dimmed until it lands. */
  readonly isRefreshing: boolean;
  /** Extra classes for the panel's own padding, when its list needs any. */
  readonly className?: string;
  readonly children: ReactNode;
}
