import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, type ReactNode } from "react";
import { WithAgentDock } from "../MainLayout";
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
// this guards lives in WithAgentDock's tree shape, not in Allotment itself.
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

  return { Allotment };
});

// WithAgentDock lives in MainLayout, whose module imports pull in the canvas
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

describe("WithAgentDock", () => {
  beforeEach(() => {
    mounts = 0;
    act(() => useAgentDockStore.getState().close());
  });

  it("keeps its children mounted across open and close", () => {
    const { unmount } = render(
      <WithAgentDock>
        <MountCounter />
      </WithAgentDock>,
    );

    expect(mounts).toBe(1);

    act(() => useAgentDockStore.getState().openSession("session-1"));
    expect(mounts).toBe(1);

    act(() => useAgentDockStore.getState().close());
    expect(mounts).toBe(1);

    unmount();
  });

  it("collapses the dock pane while nothing is open", () => {
    render(
      <WithAgentDock>
        <div>canvas</div>
      </WithAgentDock>,
    );

    const panes = screen.getAllByTestId("allotment-pane");
    expect(panes).toHaveLength(2);
    expect(panes[1]).toHaveAttribute("data-visible", "false");

    act(() => useAgentDockStore.getState().openSession("session-1"));
    expect(panes[1]).toHaveAttribute("data-visible", "true");
  });
});
