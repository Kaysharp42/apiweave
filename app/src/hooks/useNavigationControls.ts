import { useShallow } from "zustand/react/shallow";
import useNavigationStore from "../stores/NavigationStore";

/**
 * The navigation store's surface, split into narrow selectors so a consumer
 * re-renders on exactly the fields it reads — the store holds one value set and
 * one action set, but they change for different reasons: section selection,
 * rail collapse, and the mobile overlay are independent.
 *
 * Before this split, every layout component read its own handful of
 * `useNavigationStore` fields, so these hooks centralize the store's shape
 * (asserted here, once) without making a component subscribe to a field it
 * does not use.
 */

const selectNavigationSelection = (
  state: ReturnType<typeof useNavigationStore.getState>,
) => ({
  navigationSelectedValue: state.selectedNavVal,
  setNavState: state.setNavState,
});

const selectMobileSidebarControls = (
  state: ReturnType<typeof useNavigationStore.getState>,
) => ({
  mobileSidebarOpen: state.mobileSidebarOpen,
  setMobileSidebarOpen: state.setMobileSidebarOpen,
});

const selectNavBarCollapse = (
  state: ReturnType<typeof useNavigationStore.getState>,
) => ({
  isNavBarCollapsed: state.collapseNavBar,
  toggleNavBarCollapse: state.toggleNavBarCollapse,
});

const selectSidebarVisibility = (
  state: ReturnType<typeof useNavigationStore.getState>,
) => ({
  isSidebarVisible: state.sidebarVisible,
});

/**
 * Which section is selected, and the action that selects one. Every layout
 * component that renders or drives the nav needs exactly this pair.
 */
export function useNavigationSelection() {
  return useNavigationStore(useShallow(selectNavigationSelection));
}

/**
 * The mobile sidebar overlay's open flag and its setter. Only the compact
 * layout branch reads these; the desktop branch must not re-render when the
 * overlay opens under `md`.
 */
export function useMobileSidebarControls() {
  return useNavigationStore(useShallow(selectMobileSidebarControls));
}

/**
 * Whether the icon rail is collapsed, and the toggle. The collapse is the
 * only navigation field that persists across restarts and the only one
 * `DesktopSplit` cares about — it keys the Allotment layout on it.
 */
export function useNavBarCollapse() {
  return useNavigationStore(useShallow(selectNavBarCollapse));
}

/**
 * Whether the list panel beside the icon rail is showing. Ctrl+B hides the list
 * and leaves the rail in place; `DesktopSplit` reads this to size the first
 * Allotment pane down to the rail.
 */
export function useSidebarVisibility() {
  return useNavigationStore(useShallow(selectSidebarVisibility));
}
