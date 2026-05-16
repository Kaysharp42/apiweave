import { create } from 'zustand';
import { AppNavBarItems } from '../constants/AppNavBar';
import type { NavSection } from '../types/NavSection';

interface NavigationState {
  selectedNavVal: NavSection;
  collapseNavBar: boolean;
  setNavState: (navVal: NavSection) => void;
  toggleNavBarCollapse: () => void;
  setNavBarCollapsed: (collapsed: boolean) => void;
}

const useNavigationStore = create<NavigationState>()((set) => ({
  selectedNavVal: AppNavBarItems.workflows!.value as NavSection,
  collapseNavBar: false,

  setNavState: (navVal: NavSection) => set({ selectedNavVal: navVal }),
  toggleNavBarCollapse: () => set((state) => ({ collapseNavBar: !state.collapseNavBar })),
  setNavBarCollapsed: (collapsed: boolean) => set({ collapseNavBar: collapsed }),
}));

export default useNavigationStore;
