import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, type ReactNode } from "react";
import { DesktopSplit } from "../MainLayout";
import useAgentDockStore from "../../../stores/AgentDockStore";

interface AllotmentPaneProps {
  readonly children?: ReactNode;
  readonly visible?: boolean;
}

interface AllotmentProps {
  readonly children?: ReactNode;
}

// Allotment measures real DOM nodes; jsdom has no ResizeObserver, so the split
// is replaced with plain wrappers that record pane visibility. The regression
// this guards lives in DesktopSplit's tree shape, not in Allotment itself.
vi.mock("allotment", () => {
  const Pane = ({ children, visible }: AllotmentPaneProps) => (
    <div data-testid="allotment-pane" data-visible={visible ?? true}>
      {children}
    </div>
  );

  const AllotmentView = ({ children }: AllotmentProps) => (
    <div data-testid="allotment">{children}</div>
  );

  const Allotment = Object.assign(AllotmentView, {
    Pane,
  }) as unknown as typeof import("allotment").Allotment;

  // Re-exported because DesktopSplit reads it at module scope to set pane
  // priorities; a mock without it fails the import, not the assertion.
  const LayoutPriority = { Normal: 0, Low: 1, High: 2 } as const;

  return { Allotment, LayoutPriority };
});

// DesktopSplit lives in MainLayout, whose module imports pull in the canvas
// tree; none of it renders here, so the siblings are stubbed out.
vi.mock("../Workspace", () => ({ Workspace: () => null }));
vi.mock("../AppNavBar", () => ({ AppNavBar: () => null }));
vi.mock("../Sidebar", () => ({ Sidebar: () => null }));
vi.mock("../MainHeader", () => ({ MainHeader: () => null }));
vi.mock("../MainFooter", () => ({ MainFooter: () => null }));
vi.mock("../../organisms/UpdateReadyBanner", () => ({
  UpdateReadyBanner: () => null,
}));
vi.mock("../../../contexts/AgentSessionsContext", () => ({
  AgentSessionsProvider: ({
    children,
  }: {
    readonly children?: ReactNode;
  }) => <>{children}</>,
}));
vi.mock("../../organisms/AgentDock", () => ({
  AgentDock: () => <div data-testid="agent-dock" />,
}));

// Module-scoped rather than component state: a remount resets state, so the
// counter inside the component would show 1 after the new instance's first
// effect too. Only a counter that survives the instance counts remounts.
let mounts = 0;

function MountCounter() {
  useEffect(() => {
    mounts += 1;
  }, []);
  return <div data-testid="mount-counter" />;
}

/** Pane order is load-bearing: navigation, then the agent, then the workspace. */
const AGENT_PANE_INDEX = 1;

describe("DesktopSplit", () => {
  beforeEach(() => {
    mounts = 0;
    act(() => useAgentDockStore.getState().close());
  });

  it("keeps its children mounted across open and close", () => {
    const { unmount } = render(
      <DesktopSplit mountsAgentPanel>
        <MountCounter />
      </DesktopSplit>,
    );

    expect(mounts).toBe(1);

    act(() => useAgentDockStore.getState().openSession("session-1"));
    expect(mounts).toBe(1);

    act(() => useAgentDockStore.getState().close());
    expect(mounts).toBe(1);

    unmount();
  });

  it("collapses the agent pane between the sidebar and the canvas while nothing is open", () => {
    render(
      <DesktopSplit mountsAgentPanel>
        <div>canvas</div>
      </DesktopSplit>,
    );

    const panes = screen.getAllByTestId("allotment-pane");
    expect(panes).toHaveLength(3);
    expect(panes[AGENT_PANE_INDEX]).toHaveAttribute("data-visible", "false");

    act(() => useAgentDockStore.getState().openSession("session-1"));
    expect(panes[AGENT_PANE_INDEX]).toHaveAttribute("data-visible", "true");
  });

  it("renders the canvas after the agent column, not before it", () => {
    render(
      <DesktopSplit mountsAgentPanel>
        <div>canvas</div>
      </DesktopSplit>,
    );

    act(() => useAgentDockStore.getState().openSession("session-1"));

    const panes = screen.getAllByTestId("allotment-pane");
    expect(panes[AGENT_PANE_INDEX]).toContainElement(
      screen.getByTestId("agent-dock"),
    );
    expect(panes[AGENT_PANE_INDEX + 1]).toHaveTextContent("canvas");
  });

  // The compact branch mounts its own copy. A session's output port is handed to
  // exactly one holder, so a second terminal in the hidden branch takes it and
  // leaves the visible one blank — the bug that put the panel here in the first
  // place. The pane still exists so the canvas pane keeps its index.
  it("mounts no terminal when the compact branch owns it", () => {
    render(
      <DesktopSplit mountsAgentPanel={false}>
        <div>canvas</div>
      </DesktopSplit>,
    );

    act(() => useAgentDockStore.getState().openSession("session-1"));

    expect(screen.queryByTestId("agent-dock")).toBeNull();
    expect(screen.getAllByTestId("allotment-pane")).toHaveLength(3);
    expect(
      screen.getAllByTestId("allotment-pane")[AGENT_PANE_INDEX],
    ).toHaveAttribute("data-visible", "false");
  });
});
