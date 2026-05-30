import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Allotment } from 'allotment';
// @ts-expect-error CSS import without types
import 'allotment/dist/style.css';
import { useLocation } from 'react-router-dom';
import { AppNavBar } from './AppNavBar';
import { Sidebar } from './Sidebar';
import { Workspace } from './Workspace';
import { MainHeader } from './MainHeader';
import { MainFooter } from './MainFooter';
import SecretsPrompt from '../SecretsPrompt';
import useNavigationStore from '../../stores/NavigationStore';
import useSidebarStore from '../../stores/SidebarStore';
import { AppNavBarStyles } from '../../constants/AppNavBar';
import { HorizontalDivider } from '../atoms/HorizontalDivider';
import type { Environment } from '../../types/Environment';

export function MainLayout({ children }: { children?: ReactNode }) {
  const navigationSelectedValue = useNavigationStore((state) => state.selectedNavVal);
  const setNavState = useNavigationStore((state) => state.setNavState);
  const isNavBarCollapsed = useNavigationStore((state) => state.collapseNavBar);
  const location = useLocation();
  const environments = useSidebarStore((state) => state.environments);
  const fetchEnvironments = useSidebarStore((state) => state.fetchEnvironments);
  const refreshAll = useSidebarStore((state) => state.refreshAll);
  const resetPagination = useSidebarStore((state) => state.resetPagination);
  const [dismissedEnvironmentId, setDismissedEnvironmentId] = useState<string | null>(null);
  const environmentWithSecrets = useMemo<Environment | null>(() => (
    environments.find((env) => {
      if (!env.secrets || Object.keys(env.secrets).length === 0) return false;
      return !Object.keys(env.secrets).every((key) => sessionStorage.getItem(`secret_${key}`));
    }) ?? null
  ), [environments]);
  const isSecretsPromptOpen = environmentWithSecrets !== null && environmentWithSecrets.environmentId !== dismissedEnvironmentId;

  useEffect(() => {
    void fetchEnvironments();
  }, [fetchEnvironments]);

  useEffect(() => {
    if (!location.pathname.startsWith('/settings/') && navigationSelectedValue === 'settings') {
      setNavState('workflows');
    }
  }, [location.pathname, navigationSelectedValue, setNavState]);

  useEffect(() => {
    if (navigationSelectedValue === 'workflows') {
      resetPagination();
      void refreshAll(navigationSelectedValue);
    } else if (navigationSelectedValue === 'collections') {
      void refreshAll(navigationSelectedValue);
    }
  }, [navigationSelectedValue, refreshAll, resetPagination]);

  const collapsedWidth = AppNavBarStyles.collapsedNavBarWidth!.absolute;
  const expandedPreferred = 450;
  const expandedMin = 450;
  const expandedMax = 600;

  return (
    <>
      <MainHeader />
      <HorizontalDivider />

      <main className="flex-1 min-h-0 overflow-hidden bg-surface dark:bg-surface-dark">
        <Allotment>
          <Allotment.Pane
            preferredSize={isNavBarCollapsed ? collapsedWidth : expandedPreferred}
            minSize={isNavBarCollapsed ? collapsedWidth : expandedMin}
            maxSize={isNavBarCollapsed ? collapsedWidth : expandedMax}
            snap={false}
          >
            <div className="flex h-full w-full text-xs">
              <AppNavBar />
              {!isNavBarCollapsed && (
                <div className="flex-1 h-full w-full overflow-hidden bg-surface-raised dark:bg-surface-dark-raised">
                  <Sidebar
                  />
                </div>
              )}
            </div>
          </Allotment.Pane>

          <Allotment.Pane>
            {children !== undefined ? children : <Workspace />}
          </Allotment.Pane>
        </Allotment>
      </main>

      <HorizontalDivider />
      <MainFooter />

      {environmentWithSecrets && (
        <SecretsPrompt
          isOpen={isSecretsPromptOpen}
          environment={environmentWithSecrets}
          onClose={() => setDismissedEnvironmentId(environmentWithSecrets.environmentId)}
          onSecretsProvided={() => setDismissedEnvironmentId(environmentWithSecrets.environmentId)}
        />
      )}
    </>
  );
}

export default MainLayout;
