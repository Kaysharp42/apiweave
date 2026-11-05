import { create } from "zustand";
import { persist } from "zustand/middleware";
import { AppNavBarItems } from "../constants/AppNavBar";
import type { NavSection } from "../types/NavSection";

interface NavigationState {
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
