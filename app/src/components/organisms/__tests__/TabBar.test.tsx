import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../hooks/useScopeContext", () => ({
  useScopeContext: () => ({
    workspaceId: "ws-1",
    workspaceSlug: "ws-one",
    orgId: null,
    orgSlug: null,
    userId: "user-1",
    isReady: true,
  }),
}));

// jsdom has no ResizeObserver; the tab bar only uses it for scroll arrows.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe(): void {}
    disconnect(): void {}
  },
);

const { TabBar } = await import("../TabBar");
const { default: useTabStore } = await import("../../../stores/TabStore");

const tab = (id: string, name: string) => ({
  id,
  workflowId: id,
  workspaceId: "ws-1",
  name,
  isDirty: false,
});

describe("TabBar", () => {
  beforeEach(() => {
    useTabStore.setState({
      tabs: [tab("a", "Alpha"), tab("b", "Beta"), tab("c", "Gamma")],
      activeTabIdByWorkspace: { "ws-1": "a" },
    });
  });

  it("exposes the tabs as a tablist with one tab in the tab order", () => {
    render(<TabBar />);

    expect(screen.getByRole("tablist", { name: "Open workflows" })).toBeInTheDocument();
    const alpha = screen.getByRole("tab", { name: "Alpha" });
    expect(alpha).toHaveAttribute("aria-selected", "true");
    expect(alpha).toHaveAttribute("tabindex", "0");
    expect(alpha).toHaveAttribute("aria-controls", "workspace-tabpanel");
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("tabindex", "-1");
  });

  it("moves between tabs with the arrow keys, wrapping, and Home/End", async () => {
    const user = userEvent.setup();
    render(<TabBar />);

    screen.getByRole("tab", { name: "Alpha" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveFocus();
    expect(useTabStore.getState().activeTabIdByWorkspace["ws-1"]).toBe("a");
  });
});
