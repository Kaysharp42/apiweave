import { useEffect, type ReactNode } from "react";
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { useLocation } from "react-router-dom";
import { AppNavBar } from "./AppNavBar";
import { Sidebar } from "./Sidebar";
import { Workspace } from "./Workspace";
import { MainHeader } from "./MainHeader";
import { MainFooter } from "./MainFooter";
import { AgentSessionsProvider } from "../../contexts/AgentSessionsContext";
import useAgentDockStore from "../../stores/AgentDockStore";
import useNavigationStore from "../../stores/NavigationStore";
import useSidebarStore from "../../stores/SidebarStore";
import useEnvironmentStore from "../../stores/EnvironmentStore";
import { AppNavBarStyles } from "../../constants/AppNavBar";
import { HorizontalDivider } from "../atoms/HorizontalDivider";
import { AgentDock } from "../organisms/AgentDock";
import { UpdateReadyBanner } from "../organisms/UpdateReadyBanner";
import type { MainLayoutProps } from "../../types/MainLayoutProps";
import { isSettingsRoute } from "../../utils/isSettingsRoute";

export function MainLayout({ children }: MainLayoutProps) {
  const navigationSelectedValue = useNavigationStore(
    (state) => state.selectedNavVal,
  );
  const setNavState = useNavigationStore((state) => state.setNavState);
  const isNavBarCollapsed = useNavigationStore((state) => state.collapseNavBar);
  const mobileSidebarOpen = useNavigationStore(
    (state) => state.mobileSidebarOpen,
  );
  const setMobileSidebarOpen = useNavigationStore(
    (state) => state.setMobileSidebarOpen,
  );
  const location = useLocation();
  const refreshAll = useSidebarStore((state) => state.refreshAll);
  const resetPagination = useSidebarStore((state) => state.resetPagination);
  const activeWorkspaceId = useSidebarStore((state) => state.activeWorkspaceId);

  useEffect(() => {
    const workspaceId = useSidebarStore.getState().activeWorkspaceId;
    if (workspaceId) {
      void useEnvironmentStore.getState().fetchEnvironments(workspaceId);
    }
  }, []);

  useEffect(() => {
    if (
      !isSettingsRoute(location.pathname) &&
      navigationSelectedValue === "settings"
    ) {
      setNavState("workflows");
    }
  }, [location.pathname, navigationSelectedValue, setNavState]);

  useEffect(() => {
    const { workflows, allWorkflows } = useSidebarStore.getState();
    if (navigationSelectedValue === "workflows") {
      if (workflows.length === 0) {
        resetPagination();
        void refreshAll("workflows");
      }
    } else if (navigationSelectedValue === "projects") {
      if (allWorkflows.length === 0) {
        void refreshAll("projects");
      }
    }
  }, [navigationSelectedValue, activeWorkspaceId, refreshAll, resetPagination]);

  // Close mobile sidebar on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mobileSidebarOpen) {
        setMobileSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileSidebarOpen, setMobileSidebarOpen]);

  // "Collapse" only shrinks the icon rail (labels hidden); the list panel stays
  // visible either way. Pane width = rail width + list width.
  const railCollapsed = AppNavBarStyles.collapsedNavBarWidth!.absolute;
  const railExpanded = AppNavBarStyles.expandedNavBarWidth!.absolute;
  const listWidth = 236;
  const expandedPreferred = railExpanded + listWidth;
  const collapsedPreferred = railCollapsed + listWidth;
  const paneMin = collapsedPreferred;
  const paneMax = 480;

  return (
    // The agent-sessions subscription is mounted here rather than around each
    // route's shell: this component has two mount points (a route shell and
    // `pages/Home`), and a provider added above it is a provider one of them
    // will be missing. Inside it, every consumer of the nav section and the
    // terminal dock is covered by construction.
    <AgentSessionsProvider>
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

      {/* Renders nothing unless an update is downloaded and waiting on a restart. */}
      <UpdateReadyBanner />

      <WithAgentDock>
      {/* Desktop layout (lg+): Allotment split panes */}
      <div className="hidden md:flex flex-1 min-h-0 overflow-hidden bg-surface dark:bg-surface-dark">
        {/* key forces re-layout on collapse toggle — Allotment only reads
            preferredSize on mount, so without this the pane keeps its old width.
            proportionalLayout={false} keeps the sidebar pane at a fixed width
            when the window resizes; the canvas pane absorbs the whole delta. */}
        <Allotment
          key={isNavBarCollapsed ? "collapsed" : "expanded"}
          proportionalLayout={false}
        >
          <Allotment.Pane
            preferredSize={
              isNavBarCollapsed ? collapsedPreferred : expandedPreferred
            }
            minSize={paneMin}
            maxSize={paneMax}
            snap={false}
          >
            <div className="flex h-full w-full text-xs">
              <nav aria-label="Main navigation">
                <AppNavBar />
              </nav>
              <aside
                className="flex-1 h-full w-full overflow-hidden bg-surface-raised dark:bg-surface-dark-raised"
                aria-label="Sidebar"
              >
                <Sidebar />
              </aside>
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
      <div className="flex md:hidden flex-1 min-h-0 overflow-hidden bg-surface dark:bg-surface-dark">
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
              className="fixed bottom-8 left-11 top-12 z-50 flex w-72 flex-col overflow-hidden border border-border bg-surface-raised dark:border-border-dark dark:bg-surface-dark-raised"
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
      </WithAgentDock>

      <HorizontalDivider />

      <footer>
        <MainFooter />
      </footer>
    </AgentSessionsProvider>
  );
}

/**
 * The whole content area, with the agent terminal docked beneath it when one is
 * open.
 *
 * A dock rather than a page of its own: the argument for wiring the MCP bridge
 * into a launch is that the agent edits the workflow while you watch, and a
 * terminal that replaced the canvas would throw that away.
 *
 * It wraps *both* responsive layout branches rather than sitting inside each
 * one's `<main>`, which is what the first version did — and both branches are
 * always in the DOM, only one of them displayed. That mounted two terminals for
 * one session, and since a port is delivered to exactly one holder, the hidden
 * one took it: launching produced a visible terminal that stayed blank. One
 * instance is not a tidiness preference here, it is the difference between
 * working and not.
 *
 * The split is mounted unconditionally and the dock pane is collapsed while
 * nothing is open, rather than swapping between a bare fragment and an
 * Allotment. React cannot reconcile those two shapes, so the swap unmounted
 * the whole subtree — canvas included — and opening the dock discarded
 * unsaved node/edge edits. A hidden pane leaves the tree shape untouched, so
 * opening or closing the dock is now an ordinary re-render.
 */
export function WithAgentDock({ children }: { readonly children: ReactNode }) {
  const openSessionId = useAgentDockStore((state) => state.openSessionId);
  return (
    <Allotment vertical className="min-h-0 flex-1">
      <Allotment.Pane>
        {/* Allotment lays its panes out absolutely, so the branches inside need
            a flex column of their own to keep their `flex-1 min-h-0`. */}
        <div className="flex h-full min-h-0 flex-col">{children}</div>
      </Allotment.Pane>
      <Allotment.Pane
        preferredSize={300}
        minSize={110}
        visible={openSessionId !== null}
      >
        <AgentDock />
      </Allotment.Pane>
    </Allotment>
  );
}

export default MainLayout;
