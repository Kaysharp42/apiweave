import type { NavSection } from "./NavSection";

export interface NavigationState {
  selectedNavVal: NavSection;
  collapseNavBar: boolean;
  /** Whether the workflow/project list beside the icon rail is showing. */
  sidebarVisible: boolean;
  mobileSidebarOpen: boolean;
  setNavState: (navVal: NavSection) => void;
  toggleNavBarCollapse: () => void;
  setNavBarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setMobileSidebarOpen: (open: boolean) => void;
  toggleMobileSidebar: () => void;
}
