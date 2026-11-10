import { create } from "zustand";
import { persist } from "zustand/middleware";
import { AppNavBarItems } from "../constants/AppNavBar";
import type { NavigationState, NavSection } from "../types";

/**
 * Only `collapseNavBar` survives a restart. The selected section and the
 * mobile overlay are per-session UI state and are deliberately not persisted.
 */
const useNavigationStore = create<NavigationState>()(
  persist(
    (set) => ({
      selectedNavVal: AppNavBarItems.workflows!.value as NavSection,
      collapseNavBar: false,
      sidebarVisible: true,
      mobileSidebarOpen: false,

      setNavState: (navVal: NavSection) => set({ selectedNavVal: navVal }),
      toggleNavBarCollapse: () =>
        set((state) => ({ collapseNavBar: !state.collapseNavBar })),
      setNavBarCollapsed: (collapsed: boolean) =>
        set({ collapseNavBar: collapsed }),
      toggleSidebar: () =>
        set((state) => ({ sidebarVisible: !state.sidebarVisible })),
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
