import type { ReactNode } from "react";
import type { NavSection } from "./NavSection";

/**
 * A page wrapped by `App`'s `WorkspacePageRoute`, which claims a nav section for
 * the route and reports that it is covering the canvas.
 */
export interface WorkspacePageRouteProps {
  children: ReactNode;
  navState?: NavSection;
}
