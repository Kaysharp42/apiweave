import React, { useState, useEffect } from 'react';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import AppNavBar from './AppNavBar';
import Sidebar from './Sidebar';
import Workspace from './Workspace';
import MainHeader from './MainHeader';
import MainFooter from './MainFooter';
import SecretsPrompt from '../SecretsPrompt';
import useNavigationStore from '../../stores/NavigationStore';
import { AppNavBarStyles } from '../../constants/AppNavBar';
import API_BASE_URL from '../../utils/api';

const MainLayout = () => {
  const navigationSelectedValue = useNavigationStore((state) => state.selectedNavVal);
  const isNavBarCollapsed = useNavigationStore((state) => state.collapseNavBar);
  const [currentWorkflowId, setCurrentWorkflowId] = useState(null);
  const [environmentWithSecrets, setEnvironmentWithSecrets] = useState(null);
  const [showSecretsPrompt, setShowSecretsPrompt] = useState(false);

  // Check for environments with secrets on mount
  useEffect(() => {
    const checkEnvironmentSecrets = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/environments`);
        if (response.ok) {
          const environments = await response.json();
          
          // Find first environment with secrets that hasn't been entered yet
          for (const env of environments) {
            if (env.secrets && Object.keys(env.secrets).length > 0) {
              // Check if secrets for this environment have been entered
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

    // Listen for environment changes
    const handleEnvironmentsChanged = () => {
      checkEnvironmentSecrets();
    };
    window.addEventListener('environmentsChanged', handleEnvironmentsChanged);
    return () => window.removeEventListener('environmentsChanged', handleEnvironmentsChanged);
  }, []);

  // Collapsed: just the nav bar width. Expanded: nav bar + sidebar.
  const collapsedWidth = AppNavBarStyles.collapsedNavBarWidth.absolute;
  const expandedPreferred = 450;
  const expandedMin = 450;
  const expandedMax = 600;

  return (
    <>
      <MainHeader />

      {/* Horizontal divider below header */}
      <div className="h-px w-full bg-border dark:bg-border-dark" />

      <main className="flex-1 overflow-hidden bg-surface dark:bg-surface-dark">
        <Allotment>
          {/* Left: AppNavBar + Sidebar */}
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

          {/* Right: Workspace */}
          <Allotment.Pane>
            <Workspace onActiveTabChange={setCurrentWorkflowId} />
          </Allotment.Pane>
        </Allotment>
      </main>

      {/* Horizontal divider above footer */}
      <div className="h-px w-full bg-border dark:bg-border-dark" />

      <MainFooter />

      {/* Secrets Prompt */}
      {showSecretsPrompt && environmentWithSecrets && (
        <SecretsPrompt
          environment={environmentWithSecrets}
          onClose={() => setShowSecretsPrompt(false)}
          onSecretsProvided={() => setShowSecretsPrompt(false)}
        />
      )}
    </>
  );
};

export default MainLayout;

