import type { NavSection } from './NavSection';

export interface NavigationState {
  selectedNavVal: NavSection;
  collapseNavBar: boolean;
  setNavState: (navVal: NavSection) => void;
  toggleNavBarCollapse: () => void;
  setNavBarCollapsed: (collapsed: boolean) => void;
}
