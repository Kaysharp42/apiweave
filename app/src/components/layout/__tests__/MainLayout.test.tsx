import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useContext, useEffect, useLayoutEffect, type ReactNode } from "react";
import {
  MemoryRouter,
  Route,
  Routes,
  Outlet,
  useNavigate,
} from "react-router-dom";
import MainLayout from "../MainLayout";
import { CanvasSurfaceContext } from "../../../contexts/CanvasSurfaceContext";
import useNavigationStore from "../../../stores/NavigationStore";

// Allotment measures real DOM nodes and jsdom has no ResizeObserver, so the
// split becomes plain wrappers. What these tests assert lives in MainLayout's
// tree shape, not in Allotment.
vi.mock("allotment", () => {
  const Pane = ({ children }: { readonly children?: ReactNode }) => (
    <div>{children}</div>
  );
  const AllotmentView = ({ children }: { readonly children?: ReactNode }) => (
    <div>{children}</div>
  );
  const Allotment = Object.assign(AllotmentView, {
    Pane,
  }) as unknown as typeof import("allotment").Allotment;
  return { Allotment, LayoutPriority: { Normal: 0, Low: 1, High: 2 } };
});

// Module-scoped: a remount resets component state, so only a counter that
// outlives the instance can tell a re-render from a rebuild.
let canvasMounts = 0;

vi.mock("../Workspace", () => ({
  Workspace: ({ active }: { readonly active?: boolean }) => {
    useEffect(() => {
      canvasMounts += 1;
    }, []);
    return <div data-testid="canvas" data-active={String(active ?? true)} />;
  },
}));

vi.mock("../AppNavBar", () => ({
  AppNavBar: () => <div data-testid="nav-rail" />,
}));
vi.mock("../Sidebar", () => ({ Sidebar: () => <div data-testid="sidebar" /> }));
vi.mock("../MainHeader", () => ({ MainHeader: () => null }));
vi.mock("../MainFooter", () => ({ MainFooter: () => null }));
vi.mock("../../organisms/UpdateReadyBanner", () => ({
  UpdateReadyBanner: () => null,
}));
vi.mock("../../organisms/AgentDock", () => ({
  AgentDock: () => <div data-testid="agent-dock" />,
}));
vi.mock("../../../contexts/AgentSessionsContext", () => ({
  AgentSessionsProvider: ({ children }: { readonly children?: ReactNode }) => (
    <>{children}</>
  ),
}));

const CANVAS_PATH = "/ws/workflows";
const PAGE_PATH = "/ws/settings/environments";

/** Stands in for `App`'s `CanvasRoute`: a workflows path renders nothing. */
const CanvasRoute = () => null;

/** Stands in for `App`'s `WorkspacePageRoute` — the same two jobs. */
function PageSurface({ children }: { readonly children: ReactNode }) {
  const { setCovered } = useContext(CanvasSurfaceContext);
  useLayoutEffect(() => {
    setCovered(true);
    return () => setCovered(false);
  }, [setCovered]);
  return <div data-testid="page-surface">{children}</div>;
}

/** Outside `Routes` so navigating never unmounts the button itself. */
function Go() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate(CANVAS_PATH)}>
        go canvas
      </button>
      <button type="button" onClick={() => navigate(PAGE_PATH)}>
        go page
      </button>
    </>
  );
}

/**
 * The shell as `App` wires it: one layout route, a workflows path that renders
 * nothing, and a page path whose element covers the canvas.
 */
function renderShellAt(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Go />
      <Routes>
        <Route
          element={
            <MainLayout>
              <Outlet />
            </MainLayout>
          }
        >
          <Route path={CANVAS_PATH} element={<CanvasRoute />} />
          <Route
            path={PAGE_PATH}
            element={
              <PageSurface>
                <div>Environments</div>
              </PageSurface>
            }
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const click = (label: string) =>
  act(() => {
    screen.getByRole("button", { name: label }).click();
  });

describe("MainLayout", () => {
  beforeEach(() => {
    canvasMounts = 0;
    act(() => useNavigationStore.getState().setNavState("workflows"));
  });

  // Both responsive branches used to be in the DOM at once, toggled by
  // `hidden md:flex`, so everything inside `<main>` was built twice: two
  // canvases, two `WorkflowProvider`s, two tab bars, and an agent terminal whose
  // session port went to the copy nobody could see.
  it("mounts one content column, not one per responsive branch", () => {
    const { container } = renderShellAt(CANVAS_PATH);

    expect(container.querySelectorAll("#main-content")).toHaveLength(1);
    expect(screen.getAllByTestId("canvas")).toHaveLength(1);
    expect(screen.getAllByTestId("nav-rail")).toHaveLength(1);
    expect(canvasMounts).toBe(1);
  });

  // The whole point of the persistent canvas: a trip through Settings used to
  // rebuild ReactFlow, which reset the viewport and dropped unsaved edits.
  it("keeps the canvas mounted across a round trip through a page route", () => {
    renderShellAt(CANVAS_PATH);
    expect(canvasMounts).toBe(1);

    click("go page");
    expect(screen.getByTestId("page-surface")).toBeInTheDocument();
    expect(canvasMounts).toBe(1);

    click("go canvas");
    expect(screen.queryByTestId("page-surface")).toBeNull();
    expect(canvasMounts).toBe(1);
  });

  // `display`, not `visibility`: ReactFlow re-declares `visibility: visible` on
  // its nodes, and a descendant wins that, so a hidden ancestor left the nodes
  // painted, focusable and announced behind the page.
  it("hides the canvas and stands it down while a page covers it", () => {
    renderShellAt(CANVAS_PATH);

    click("go page");

    const canvas = screen.getByTestId("canvas");
    expect(canvas.parentElement).toHaveStyle({ display: "none" });
    expect(canvas).toHaveAttribute("data-active", "false");
  });

  it("shows the canvas and lets it act again once the page goes away", () => {
    renderShellAt(PAGE_PATH);
    expect(screen.getByTestId("canvas")).toHaveAttribute(
      "data-active",
      "false",
    );

    click("go canvas");

    const canvas = screen.getByTestId("canvas");
    expect(canvas.parentElement).not.toHaveStyle({ display: "none" });
    expect(canvas).toHaveAttribute("data-active", "true");
  });
});
