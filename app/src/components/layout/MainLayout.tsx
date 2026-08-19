import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Allotment, LayoutPriority } from "allotment";
import "allotment/dist/style.css";
import { useLocation } from "react-router-dom";
import { AppNavBar } from "./AppNavBar";
import { Sidebar } from "./Sidebar";
import { Workspace } from "./Workspace";
import { MainHeader } from "./MainHeader";
import { MainFooter } from "./MainFooter";
import { useShallow } from "zustand/react/shallow";
import { AgentSessionsProvider } from "../../contexts/AgentSessionsContext";
import { CanvasSurfaceContext } from "../../contexts/CanvasSurfaceContext";
import { useOpenAgentSessionId } from "../../hooks/useAgentDockControls";
import {
  useMobileSidebarControls,
  useNavigationSelection,
  useNavBarCollapse,
} from "../../hooks/useNavigationControls";
import useSidebarStore from "../../stores/SidebarStore";
import useEnvironmentStore from "../../stores/EnvironmentStore";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { AppNavBarStyles } from "../../constants/AppNavBar";
import { HorizontalDivider } from "../atoms/HorizontalDivider";
import { AgentDock } from "../organisms/AgentDock";
import { UpdateReadyBanner } from "../organisms/UpdateReadyBanner";
import type { MainLayoutProps } from "../../types/MainLayoutProps";
import { isSettingsRoute } from "../../utils/isSettingsRoute";

/**
 * Below Tailwind's `md`, where the layout drops to a single content column.
 * 767.98 rather than 767 because the viewport can land on a fractional width
 * under a non-integer device pixel ratio.
 *
 * This now *chooses* a branch rather than hiding one: crossing it swaps
 * `CompactShell` for `DesktopSplit`, which remounts the content. The desktop
 * shell clamps its window to `minWidth: 1024`, so only the browser build can
 * cross it, and only by a deliberate resize.
 */
const COMPACT_LAYOUT_QUERY = "(max-width: 767.98px)";

/** Roughly 60 columns of the terminal's 12px monospace, plus its chrome. */
const AGENT_PANE_PREFERRED = 420;
const AGENT_PANE_MIN = 280;
const AGENT_PANE_MAX = 900;

export function MainLayout({ children }: MainLayoutProps) {
  const { navigationSelectedValue, setNavState } = useNavigationSelection();
  const location = useLocation();
  // One selector rather than three. The claim `useShallow` supports here is
  // narrow: the two actions in this object are stable references, so the
  // object identity changes exactly when `activeWorkspaceId` does — which is
  // the same re-render the three separate subscriptions produced. The other
  // stores above and below use separate selectors per consumer for exactly
  // this reason; do not merge them into one.
  const { refreshAll, resetPagination, activeWorkspaceId } = useSidebarStore(
    useShallow((state) => ({
      refreshAll: state.refreshAll,
      resetPagination: state.resetPagination,
      activeWorkspaceId: state.activeWorkspaceId,
    })),
  );

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

  // Which shell to build. Exactly one of the two is mounted, so nothing inside
  // `<main>`, and nothing either branch owns, exists twice.
  const isCompact = useMediaQuery(COMPACT_LAYOUT_QUERY);

  // Set by whichever page route currently covers the canvas; see
  // `CanvasSurfaceContext` for why the surface reports this instead of the
  // layout matching the path.
  const [isCanvasCovered, setCanvasCovered] = useState(false);
  const canvasSurface = useMemo(() => ({ setCovered: setCanvasCovered }), []);

  // One `<main>`, built once and handed to whichever branch renders.
  const content = (
    <main
      id="main-content"
      className="relative h-full min-w-0 flex-1 overflow-hidden"
    >
      {/* The canvas outlives the route. It used to be the route element for
          the workflows paths, so opening Settings unmounted it and coming back
          built a new ReactFlow from scratch — which reset the viewport and threw
          away unsaved node and edge edits, the same loss `DesktopSplit` describes
          for a pane that appears and disappears.

          `display` rather than `visibility`: ReactFlow's stylesheet sets
          `visibility: visible` on `.react-flow__node`, and the descendant wins
          that declaration — so under a hidden ancestor the nodes and their
          buttons stayed painted, focusable and announced behind the page.
          `display: none` cannot be overridden from below, and ReactFlow holds its
          transform across the round trip, so the viewport comes back exactly
          where it was left rather than refitting. */}
      <div
        className="absolute inset-0"
        style={isCanvasCovered ? { display: "none" } : undefined}
      >
        <Workspace active={!isCanvasCovered} />
      </div>

      {children}
    </main>
  );

  return (
    // The agent-sessions subscription is mounted here rather than in `App`'s
    // shell route, so it covers every consumer of the nav section and the agent
    // panel by construction. It also survives navigation: the shell above is a
    // layout route, so this provider and the terminal's MessagePort under it are
    // created once per session rather than once per route.
    <AgentSessionsProvider>
      <CanvasSurfaceContext.Provider value={canvasSurface}>
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

        <div className="flex flex-1 min-h-0 overflow-hidden bg-surface dark:bg-surface-dark">
          {isCompact ? (
            <CompactShell>{content}</CompactShell>
          ) : (
            <DesktopSplit>{content}</DesktopSplit>
          )}
        </div>

        <HorizontalDivider />

        <footer>
          <MainFooter />
        </footer>
      </CanvasSurfaceContext.Provider>
    </AgentSessionsProvider>
  );
}

/**
 * The content area under Tailwind's `md`, where there is no room for three
 * columns: the icon rail stays put, and the sidebar and the agent become drawers
 * over the canvas.
 *
 * A sibling of `DesktopSplit`, and only one of the two is ever mounted. Both
 * used to sit in the DOM at once, toggled by `hidden md:flex`, so everything
 * inside `<main>` was instantiated twice — two canvases, two `WorkflowProvider`s,
 * two tab bars — and the agent terminal's `MessagePort`, which has exactly one
 * holder, went to the copy nobody could see.
 */
function CompactShell({ children }: { readonly children: ReactNode }) {
  const { mobileSidebarOpen, setMobileSidebarOpen } =
    useMobileSidebarControls();
  const openSessionId = useOpenAgentSessionId();

  // Only this branch has a dismissable drawer, so the Escape handler lives here
  // rather than in the layout above.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mobileSidebarOpen) {
        setMobileSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileSidebarOpen, setMobileSidebarOpen]);

  return (
    <>
      {/* No wrapping landmark: `AppNavBar` renders its own labelled <nav>, and
          naming this too made a screen reader announce "Main navigation" twice
          on the way in — the same duplication the agent drawer below avoids. */}
      <AppNavBar />

      {mobileSidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-text-primary/30 motion-reduce:transition-none dark:bg-text-primary-dark/30"
            onClick={() => setMobileSidebarOpen(false)}
            aria-hidden="true"
          />
          {/* A plain positioning wrapper: `Sidebar` is the labelled landmark,
              and labelling the drawer too announced "Sidebar" twice. */}
          <div className="fixed bottom-8 left-11 top-12 z-50 flex w-72 flex-col overflow-hidden border border-border bg-surface-raised dark:border-border-dark dark:bg-surface-dark-raised">
            <Sidebar />
          </div>
        </>
      )}

      {/* Too narrow for a third column, so the agent takes the same left drawer
          slot the sidebar uses here — still anchored to the left edge, still
          beside the canvas rather than on top of it.

          The wrapper is deliberately unlabelled: `AgentDock` renders its own
          labelled <section>, and naming this too makes a screen reader announce
          the same region twice on the way in. */}
      {openSessionId !== null && (
        <aside className="fixed bottom-8 left-11 top-12 z-40 flex w-[min(22rem,calc(100vw-3.5rem))] flex-col overflow-hidden border border-border bg-surface-raised dark:border-border-dark dark:bg-surface-dark-raised">
          <AgentDock />
        </aside>
      )}

      {children}
    </>
  );
}

/**
 * The desktop content area: navigation, the agent terminal, and the workspace,
 * as three resizable columns.
 *
 * The agent sits *between* the sidebar and the canvas rather than in a strip
 * below it. A column on the left reads as part of the app's own structure — the
 * same rail → list → content progression the rest of the layout already has —
 * and it leaves the canvas beside it rather than under it. Keeping the canvas
 * visible is the entire argument for wiring MCP into a launch: the agent edits
 * the workflow while you watch it happen.
 *
 * Every pane is mounted unconditionally and the agent pane is collapsed with
 * `visible` while nothing is open, rather than adding and removing it. React
 * reconciles by position, so a pane that appears and disappears shifts the
 * canvas pane's index and remounts the whole workspace subtree — which
 * discarded unsaved node and edge edits every time an agent was launched. A
 * hidden pane leaves the tree shape untouched, so opening or closing the panel
 * is an ordinary re-render. `DesktopSplit.test.tsx` guards exactly this.
 */
export function DesktopSplit({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { isNavBarCollapsed } = useNavBarCollapse();
  const openSessionId = useOpenAgentSessionId();

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
    /* key forces re-layout on collapse toggle — Allotment only reads
       preferredSize on mount, so without this the pane keeps its old width.
       proportionalLayout={false} keeps the sidebar and agent panes at fixed
       widths when the window resizes; the canvas pane absorbs the whole
       delta. */
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
        priority={LayoutPriority.Low}
      >
        <div className="flex h-full w-full text-xs">
          {/* Unwrapped for the same reason as the compact branch: the rail is
              already a labelled <nav>. */}
          <AppNavBar />
          {/* Sizing only — the landmark is `Sidebar`'s own <aside>. */}
          <div className="flex-1 h-full w-full overflow-hidden bg-surface-raised dark:bg-surface-dark-raised">
            <Sidebar />
          </div>
        </div>
      </Allotment.Pane>

      {/* maxSize as well as minSize: a terminal that can be dragged to fill the
          window would hide the canvas it is supposed to be editing, and the
          column cannot be shrunk below a legible line of monospace.

          preferredSize is 0 while closed rather than a constant 420: Allotment
          applies every pane's preferredSize once at mount, before `visible`
          is, so a fixed 420 here reserved the width up front and then had
          nowhere to put it back once the pane collapsed — the sidebar (the
          only other Low-priority pane) absorbed the permanent 64px deficit.
          At a narrow desktop width that was enough to crush the workflow list
          into the hover-affordance column next to it, which is what
          `node-modal.spec.ts`'s 768px viewport caught. */}
      <Allotment.Pane
        preferredSize={openSessionId !== null ? AGENT_PANE_PREFERRED : 0}
        minSize={AGENT_PANE_MIN}
        maxSize={AGENT_PANE_MAX}
        snap={false}
        priority={LayoutPriority.Low}
        visible={openSessionId !== null}
      >
        <AgentDock />
      </Allotment.Pane>

      {/* The only pane that gives up space. Without an explicit priority
          Allotment took the agent column's width out of the pane next to it, so
          opening an agent crushed the sidebar down to truncated single words
          while the canvas — the pane with room to spare — kept every pixel. */}
      <Allotment.Pane priority={LayoutPriority.High}>{children}</Allotment.Pane>
    </Allotment>
  );
}

export default MainLayout;
