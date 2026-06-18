import { useEffect } from 'react';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { useLocation } from 'react-router-dom';
import { AppNavBar } from './AppNavBar';
import { Sidebar } from './Sidebar';
import { Workspace } from './Workspace';
import { MainHeader } from './MainHeader';
import { MainFooter } from './MainFooter';
import useNavigationStore from '../../stores/NavigationStore';
import useSidebarStore from '../../stores/SidebarStore';
import { AppNavBarStyles } from '../../constants/AppNavBar';
import { HorizontalDivider } from '../atoms/HorizontalDivider';
import type { MainLayoutProps } from '../../types/MainLayoutProps';

export function MainLayout({ children }: MainLayoutProps) {
  const navigationSelectedValue = useNavigationStore((state) => state.selectedNavVal);
  const setNavState = useNavigationStore((state) => state.setNavState);
  const isNavBarCollapsed = useNavigationStore((state) => state.collapseNavBar);
  const mobileSidebarOpen = useNavigationStore((state) => state.mobileSidebarOpen);
  const setMobileSidebarOpen = useNavigationStore((state) => state.setMobileSidebarOpen);
  const location = useLocation();
  const fetchEnvironments = useSidebarStore((state) => state.fetchEnvironments);
  const refreshAll = useSidebarStore((state) => state.refreshAll);
  const resetPagination = useSidebarStore((state) => state.resetPagination);

  useEffect(() => {
    void fetchEnvironments();
  }, [fetchEnvironments]);

  useEffect(() => {
    const isSettingsRoute = location.pathname.includes('/settings/') || location.pathname === '/audit';
    if (!isSettingsRoute && navigationSelectedValue === 'settings') {
      setNavState('workflows');
    }
  }, [location.pathname, navigationSelectedValue, setNavState]);

  useEffect(() => {
    if (navigationSelectedValue === 'workflows') {
      resetPagination();
      void refreshAll(navigationSelectedValue);
    } else if (navigationSelectedValue === 'projects') {
      void refreshAll(navigationSelectedValue);
    }
  }, [navigationSelectedValue, refreshAll, resetPagination]);

  // Close mobile sidebar on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileSidebarOpen) {
        setMobileSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileSidebarOpen, setMobileSidebarOpen]);

  const collapsedWidth = AppNavBarStyles.collapsedNavBarWidth!.absolute;
  const expandedPreferred = 450;
  const expandedMin = 450;
  const expandedMax = 600;

  return (
    <>
      {/* Skip to main content link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:border focus:border-border focus:bg-surface-raised focus:px-4 focus:py-2 focus:text-text-primary focus:outline-2 focus:outline-primary focus:outline-offset-2 dark:focus:border-border-dark dark:focus:bg-surface-dark-raised dark:focus:text-text-primary-dark dark:focus:outline-primary-light"
      >
        Skip to main content
      </a>

      <header>
        <MainHeader />
      </header>

      <HorizontalDivider />

      {/* Desktop layout (lg+): Allotment split panes */}
      <div className="hidden lg:flex flex-1 min-h-0 overflow-hidden bg-surface dark:bg-surface-dark">
        <Allotment>
          <Allotment.Pane
            preferredSize={isNavBarCollapsed ? collapsedWidth : expandedPreferred}
            minSize={isNavBarCollapsed ? collapsedWidth : expandedMin}
            maxSize={isNavBarCollapsed ? collapsedWidth : expandedMax}
            snap={false}
          >
            <div className="flex h-full w-full text-xs">
              <nav aria-label="Main navigation">
                <AppNavBar />
              </nav>
              {!isNavBarCollapsed && (
                <aside
                  className="flex-1 h-full w-full overflow-hidden bg-surface-raised dark:bg-surface-dark-raised"
                  aria-label="Sidebar"
                >
                  <Sidebar />
                </aside>
              )}
            </div>
          </Allotment.Pane>

          <Allotment.Pane>
            <main id="main-content" className="h-full">
              {children !== undefined ? children : <Workspace />}
            </main>
          </Allotment.Pane>
        </Allotment>
      </div>

      {/* Mobile layout (< lg): flex with collapsible sidebar overlay */}
      <div className="flex lg:hidden flex-1 min-h-0 overflow-hidden bg-surface dark:bg-surface-dark">
        <nav aria-label="Main navigation">
          <AppNavBar />
        </nav>

        {mobileSidebarOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-text-primary/30 motion-reduce:transition-none dark:bg-text-primary-dark/30"
              onClick={() => setMobileSidebarOpen(false)}
              aria-hidden="true"
            />
            <aside
              className="fixed bottom-8 left-14 top-12 z-50 flex w-80 flex-col overflow-hidden border border-border bg-surface-raised dark:border-border-dark dark:bg-surface-dark-raised"
              aria-label="Sidebar"
            >
              <Sidebar />
            </aside>
          </>
        )}

        <main id="main-content" className="flex-1 min-w-0 overflow-hidden">
          {children !== undefined ? children : <Workspace />}
        </main>
      </div>

      <HorizontalDivider />

      <footer>
        <MainFooter />
      </footer>
    </>
  );
}

export default MainLayout;
