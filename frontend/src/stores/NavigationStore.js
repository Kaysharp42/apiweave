import { create } from 'zustand';
import { AppNavBarItems } from '../constants/AppNavBar';

const useNavigationStore = create((set) => ({
  selectedNavVal: AppNavBarItems.workflows.value,
  collapseNavBar: false,
  
  setNavState: (navVal) => set({ selectedNavVal: navVal }),
  toggleNavBarCollapse: () => set((state) => ({ collapseNavBar: !state.collapseNavBar })),
  setNavBarCollapsed: (collapsed) => set({ collapseNavBar: collapsed }),
}));

export default useNavigationStore;