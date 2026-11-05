import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The unsaved-changes guard would open a modal; every close here is allowed.
vi.mock("../../../stores/PendingEditsStore", () => ({
  confirmCloseTabs: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("../../../hooks/useScopeContext", () => ({
  useScopeContext: () => ({
    workspaceId: "ws-1",
    workspaceSlug: "ws-one",
    orgId: null,
    orgSlug: null,
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
const { confirmCloseTabs } = await import("../../../stores/PendingEditsStore");
const confirmCloseTabsMock = vi.mocked(confirmCloseTabs);

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
    confirmCloseTabsMock.mockClear();
    confirmCloseTabsMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("closes a tab from its own close button after confirming, without activating it", async () => {
    const user = userEvent.setup();
    const setActive = vi.spyOn(useTabStore.getState(), "setActive");
    const closeTab = vi.spyOn(useTabStore.getState(), "closeTab");
    render(<TabBar />);

    await user.click(screen.getByTitle("Close Beta"));

    expect(confirmCloseTabsMock).toHaveBeenCalledTimes(1);
    expect(confirmCloseTabsMock).toHaveBeenCalledWith(["b"]);
    await waitFor(() => expect(closeTab).toHaveBeenCalledWith("b"));
    // The close button sits beside the tab button, so its click must not reach
    // the activation or middle-click handlers — one close, no activation.
    expect(closeTab).toHaveBeenCalledTimes(1);
    expect(setActive).not.toHaveBeenCalled();
    expect(
      confirmCloseTabsMock.mock.invocationCallOrder[0],
    ).toBeLessThan(closeTab.mock.invocationCallOrder[0] ?? Infinity);
  });

  it("closes the focused tab with Delete", async () => {
    const user = userEvent.setup();
    const closeTab = vi.spyOn(useTabStore.getState(), "closeTab");
    render(<TabBar />);

    screen.getByRole("tab", { name: "Alpha" }).focus();
    await user.keyboard("{Delete}");

    expect(confirmCloseTabsMock).toHaveBeenCalledWith(["a"]);
    await waitFor(() => expect(closeTab).toHaveBeenCalledWith("a"));
    expect(closeTab).toHaveBeenCalledTimes(1);
  });

  it("opens the tab menu with Shift+F10 and shows the close shortcut", async () => {
    const user = userEvent.setup();
    render(<TabBar />);

    const beta = screen.getByRole("tab", { name: "Beta" });
    beta.focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");

    const menu = await screen.findByRole("menu", { name: "Tab actions" });
    expect(menu).toBeInTheDocument();
    const close = screen.getByText("Close").closest('[role="menuitem"]');
    expect(close).toHaveTextContent(/W$/);
  });

  it("opens the tab menu from the ContextMenu key", async () => {
    render(<TabBar />);
    const gamma = screen.getByRole("tab", { name: "Gamma" });

    fireEvent.keyDown(gamma, { key: "ContextMenu" });

    expect(
      await screen.findByRole("menu", { name: "Tab actions" }),
    ).toBeInTheDocument();
  });

  it("closes only the tabs to the right, scoped to the workspace", async () => {
    const user = userEvent.setup();
    render(<TabBar />);

    fireEvent.contextMenu(screen.getByRole("tab", { name: "Beta" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Close to the Right" }),
    );

    expect(confirmCloseTabsMock).toHaveBeenCalledWith(["c"]);
    await waitFor(() =>
      expect(useTabStore.getState().tabs.map((tab) => tab.id)).toEqual([
        "a",
        "b",
      ]),
    );
  });

  it("keeps each tab at least 96px wide so the strip overflows instead of collapsing", () => {
    render(<TabBar />);

    expect(
      screen.getByRole("tab", { name: "Alpha" }).parentElement,
    ).toHaveClass("min-w-24");
  });

  it("scrolls the newly activated tab into view", async () => {
    const proto = Element.prototype as Element & {
      scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
    };
    const original = proto.scrollIntoView;
    const seen: Element[] = [];
    proto.scrollIntoView = function (this: Element) {
      seen.push(this);
    };

    try {
      const user = userEvent.setup();
      render(<TabBar />);

      await user.click(screen.getByRole("tab", { name: "Beta" }));

      expect(seen.at(-1)).toBe(screen.getByRole("tab", { name: "Beta" }));
    } finally {
      if (original) proto.scrollIntoView = original;
      else Reflect.deleteProperty(proto, "scrollIntoView");
    }
  });

  it("highlights the tab whose context menu is open", async () => {
    render(<TabBar />);

    fireEvent.contextMenu(screen.getByRole("tab", { name: "Beta" }));

    await screen.findByRole("menu", { name: "Tab actions" });
    const beta = screen.getByRole("tab", { name: "Beta" });
    expect(beta).toHaveClass("bg-surface-overlay");
    expect(beta).toHaveClass("dark:bg-surface-dark-overlay");
  });

  it("keeps Close All neutral rather than destructive", async () => {
    render(<TabBar />);

    fireEvent.contextMenu(screen.getByRole("tab", { name: "Alpha" }));

    const closeAll = await screen.findByRole("menuitem", { name: "Close All" });
    expect(closeAll).not.toHaveClass("text-status-error");
  });

  it("keeps every close button inside a tab wrapper, none outside the tablist", () => {
    render(<TabBar />);

    const tablist = screen.getByRole("tablist", { name: "Open workflows" });
    const closeButtons = within(tablist).getAllByTitle(/^Close /);
    expect(closeButtons).toHaveLength(3);

    for (const button of closeButtons) {
      // A tablist may own tabs and nothing else: the button is a sibling of a
      // tab, pointer-only, and hidden from the accessibility tree.
      expect(button.closest('[role="tab"]')).toBeNull();
      expect(button.parentElement?.querySelector('[role="tab"]')).not.toBeNull();
      expect(button).toHaveAttribute("aria-hidden", "true");
      expect(button).toHaveAttribute("tabindex", "-1");
    }

    // No trailing close button beside the tablist, and none reachable by name.
    expect(document.querySelectorAll('[title^="Close "]')).toHaveLength(3);
    expect(
      screen.queryByRole("button", { name: "Close Alpha" }),
    ).not.toBeInTheDocument();
  });
});
