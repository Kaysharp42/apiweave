import type { ReactNode } from "react";

export interface MainLayoutProps {
  /**
   * The routed page. Always supplied — `App` mounts the layout from a single
   * shell route and passes `<Outlet />`. It used to be optional, falling back to
   * the canvas, which is what let the layout have a second mount point.
   */
  children: ReactNode;
}
