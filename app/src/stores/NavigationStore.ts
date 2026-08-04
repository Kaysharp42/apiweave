import { create } from "zustand";
import { persist } from "zustand/middleware";
import { AppNavBarItems } from "../constants/AppNavBar";
import type { NavSection } from "../types/NavSection";

interface NavigationState {
  selectedNavVal: NavSection;
  collapseNavBar: boolean;
  mobileSidebarOpen: boolean;
  setNavState: (navVal: NavSection) => void;
  toggleNavBarCollapse: () => void;
  setNavBarCollapsed: (collapsed: boolean) => void;
  setMobileSidebarOpen: (open: boolean) => void;
  toggleMobileSidebar: () => void;
}

/**
 * Only `collapseNavBar` survives a restart. The selected section and the
 * mobile overlay are per-session UI state and are deliberately not persisted.
 */
const useNavigationStore = create<NavigationState>()(
  persist(
    (set) => ({
      selectedNavVal: AppNavBarItems.workflows!.value as NavSection,
      collapseNavBar: false,
      mobileSidebarOpen: false,

      setNavState: (navVal: NavSection) => set({ selectedNavVal: navVal }),
      toggleNavBarCollapse: () =>
        set((state) => ({ collapseNavBar: !state.collapseNavBar })),
      setNavBarCollapsed: (collapsed: boolean) =>
        set({ collapseNavBar: collapsed }),
      setMobileSidebarOpen: (open: boolean) => set({ mobileSidebarOpen: open }),
      toggleMobileSidebar: () =>
        set((state) => ({ mobileSidebarOpen: !state.mobileSidebarOpen })),
    }),
    {
      name: "apiweave:v1:navigation",
      partialize: (state) => ({ collapseNavBar: state.collapseNavBar }),
    },
  ),
);

export default useNavigationStore;
