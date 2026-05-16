import { useState, useEffect } from 'react';
import { Allotment } from 'allotment';
// @ts-expect-error CSS import without types
import 'allotment/dist/style.css';
import { AppNavBar } from './AppNavBar';
import { Sidebar } from './Sidebar';
import { Workspace } from './Workspace';
import { MainHeader } from './MainHeader';
import { MainFooter } from './MainFooter';
// @ts-expect-error SecretsPrompt.jsx not yet migrated
import SecretsPrompt from '../SecretsPrompt';
import useNavigationStore from '../../stores/NavigationStore';
import useSidebarStore from '../../stores/SidebarStore';
import { AppNavBarStyles } from '../../constants/AppNavBar';
import { HorizontalDivider } from '../atoms';
// @ts-expect-error api.js not yet migrated
import API_BASE_URL from '../../utils/api';
import type { Environment } from '../../types/Environment';

export function MainLayout() {
  const navigationSelectedValue = useNavigationStore((state) => state.selectedNavVal);
  const isNavBarCollapsed = useNavigationStore((state) => state.collapseNavBar);
  const [currentWorkflowId, setCurrentWorkflowId] = useState<string | null>(null);
  const [environmentWithSecrets, setEnvironmentWithSecrets] = useState<Environment | null>(null);
  const [showSecretsPrompt, setShowSecretsPrompt] = useState(false);

  useEffect(() => {
    const checkEnvironmentSecrets = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/environments`);
        if (response.ok) {
          const environments: Environment[] = await response.json();

          for (const env of environments) {
            if (env.secrets && Object.keys(env.secrets).length > 0) {
              const secretsEntered = Object.keys(env.secrets).every((key) =>
                sessionStorage.getItem(`secret_${key}`)
              );

              if (!secretsEntered) {
                setEnvironmentWithSecrets(env);
                setShowSecretsPrompt(true);
                break;
              }
            }
          }
        }
      } catch (error) {
        console.error('Error checking environment secrets:', error);
      }
    };

    checkEnvironmentSecrets();
  }, []);

  const environmentVersion = useSidebarStore((s) => s.environmentVersion);
  useEffect(() => {
    if (environmentVersion > 0) {
      const checkSecrets = async () => {
        try {
          const response = await fetch(`${API_BASE_URL}/api/environments`);
          if (response.ok) {
            const envs: Environment[] = await response.json();
            for (const env of envs) {
              if (env.isActive && env.secrets) {
                for (const [, val] of Object.entries(env.secrets)) {
                  if (!val || val === '***') {
                    setShowSecretsPrompt(true);
                    return;
                  }
                }
              }
            }
          }
        } catch (error) {
          console.error('Error checking environment secrets:', error);
        }
      };
      checkSecrets();
    }
  }, [environmentVersion]);

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
                    selectedNav={navigationSelectedValue}
                    currentWorkflowId={currentWorkflowId}
                  />
                </div>
              )}
            </div>
          </Allotment.Pane>

          <Allotment.Pane>
            <Workspace onActiveTabChange={setCurrentWorkflowId} />
          </Allotment.Pane>
        </Allotment>
      </main>

      <HorizontalDivider />
      <MainFooter />

      <SecretsPrompt
        open={showSecretsPrompt && !!environmentWithSecrets}
        environment={environmentWithSecrets ?? { isActive: false, environmentId: '', name: '', secrets: {} }}
        onClose={() => setShowSecretsPrompt(false)}
        onSecretsProvided={() => setShowSecretsPrompt(false)}
      />
    </>
  );
}

export default MainLayout;
