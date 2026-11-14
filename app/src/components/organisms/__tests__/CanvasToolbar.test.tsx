import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CanvasToolbarProps } from "../../../types/CanvasToolbarProps";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasToolbar } from "../CanvasToolbar";

// jsdom has no ResizeObserver; Headless UI's anchored menus observe their
// trigger and panel as they open.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

function renderToolbar(props: Partial<CanvasToolbarProps> = {}) {
  render(
    <CanvasToolbar
      onSave={vi.fn()}
      onUndo={vi.fn()}
      onRedo={vi.fn()}
      canUndo={false}
      canRedo={false}
      onGroup={vi.fn()}
      onUngroup={vi.fn()}
      canGroup={false}
      canUngroup={false}
      onHistory={vi.fn()}
      onVersionHistory={vi.fn()}
      onJsonEditor={vi.fn()}
      onImport={vi.fn()}
      onCommandPalette={vi.fn()}
      onRun={vi.fn()}
      environments={[]}
      onEnvironmentChange={vi.fn()}
      {...props}
    />,
  );

  return screen.getByRole("toolbar", { name: "Workflow actions" });
}

describe("CanvasToolbar", () => {
  it("stays below the global popup layer", () => {
    // The stacking layer lives on the track the bar centres in, not on the bar
    // itself — the track is the positioned element.
    const track = renderToolbar().parentElement;

    expect(track).toHaveClass("z-20");
    expect(track).not.toHaveClass("z-50");
  });

  // `CanvasToolbarBand` tells the run camera how tall this bar is, and it only
  // ever describes one row. A `flex-wrap` here would make the camera frame
  // running nodes underneath the toolbar without anything failing loudly.
  it("never wraps to a second row", () => {
    const toolbar = renderToolbar();

    expect(toolbar).toHaveClass("flex-nowrap");
    expect(toolbar).not.toHaveClass("flex-wrap");
  });

  it("offers the latest failed run's failed branches, and each failed step, from the Run menu", () => {
    const onRerunFailed = vi.fn();
    const onRunFromFailedNode = vi.fn();
    renderToolbar({
      onRerunFailed,
      onRunFromFailedNode,
      resumeOptions: [{ nodeId: "http-1", label: "Get user" }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Run options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rerun failed branches" }));
    expect(onRerunFailed).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Run options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Run from Get user" }));
    expect(onRunFromFailedNode).toHaveBeenCalledWith("http-1");
  });

  it("exposes the Run options menu and returns focus on Escape", async () => {
    const user = userEvent.setup();
    renderToolbar();

    const trigger = screen.getByRole("button", { name: "Run options" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    trigger.focus();
    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu", { name: "Run options" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu", { name: "Run options" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("moves between Run menu items with the arrow keys", async () => {
    const user = userEvent.setup();
    renderToolbar({
      onRunFromFailedNode: vi.fn(),
      resumeOptions: [{ nodeId: "http-1", label: "Get user" }],
    });

    await user.click(screen.getByRole("button", { name: "Run options" }));
    await user.keyboard("{ArrowDown}");

    const rerun = screen.getByRole("menuitem", {
      name: "Rerun failed branches",
    });
    const fromUser = screen.getByRole("menuitem", {
      name: "Run from Get user",
    });
    expect(rerun).toHaveAttribute("data-focus");
    expect(fromUser).not.toHaveAttribute("data-focus");

    await user.keyboard("{ArrowDown}");
    expect(rerun).not.toHaveAttribute("data-focus");
    expect(fromUser).toHaveAttribute("data-focus");
  });

  it("shows a disabled Rerun failed branches row with an explanation when there is nothing to rerun", async () => {
    const user = userEvent.setup();
    renderToolbar();

    await user.click(screen.getByRole("button", { name: "Run options" }));

    const rerun = screen.getByRole("menuitem", {
      name: /Rerun failed branches/,
    });
    expect(rerun).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("No failed run to rerun.")).toHaveClass(
      "text-text-secondary",
    );
  });

  it("opens Version history", () => {
    const onVersionHistory = vi.fn();
    renderToolbar({ onVersionHistory });
    fireEvent.click(screen.getByRole("button", { name: "Version history" }));
    expect(onVersionHistory).toHaveBeenCalled();
  });

  it("separates the toolbar into save, history, structure and action groups", () => {
    renderToolbar();

    expect(screen.getAllByTestId("toolbar-divider")).toHaveLength(5);
  });

  it("names run history and version history as different things", () => {
    renderToolbar();

    expect(
      screen.getByRole("button", { name: "Run history" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Version history" }),
    ).toBeInTheDocument();
  });

  it("shows toolbar tooltips on keyboard focus", async () => {
    renderToolbar();

    fireEvent.focus(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Save workflow (Ctrl+S)",
    );
  });

  it("hides Refresh from OpenAPI spec when the environment has no spec", () => {
    renderToolbar();

    expect(
      screen.queryByRole("button", { name: "Refresh from OpenAPI spec" }),
    ).not.toBeInTheDocument();
  });

  it("offers Refresh from OpenAPI spec when the environment has one", () => {
    renderToolbar({ hasOpenApiSource: true });

    expect(
      screen.getByRole("button", { name: "Refresh from OpenAPI spec" }),
    ).toBeInTheDocument();
  });

  it("runs with the data file the user picks", () => {
    const onRunWithData = vi.fn();
    renderToolbar({ onRunWithData });
    const file = new File(["user\nann\n"], "users.csv", { type: "text/csv" });

    fireEvent.change(screen.getByLabelText("Data file to run with"), { target: { files: [file] } });

    expect(onRunWithData).toHaveBeenCalledWith(file);
    expect(screen.getByRole("button", { name: "Run with data" })).toBeEnabled();
  });

  it("shows which iteration of a data-driven run is running", () => {
    renderToolbar({ onRunWithData: vi.fn(), isRunning: true, iteration: { groupId: "g", index: 3, count: 10 } });

    expect(screen.getByText("Iteration 3/10")).toBeInTheDocument();
    // Soft-disabled: it keeps its tooltip, so it says so with aria-disabled rather than the native attribute.
    expect(screen.getByRole("button", { name: "Run with data" })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("CanvasToolbar load run", () => {
  it("opens the Load run dialog from the Run options menu", async () => {
    const onLoad = vi.fn();
    renderToolbar({ onLoad });

    await userEvent.click(screen.getByRole("button", { name: "Run options" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Load run/ }));

    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it("has no Load run row without a handler", async () => {
    renderToolbar();

    await userEvent.click(screen.getByRole("button", { name: "Run options" }));

    expect(screen.queryByRole("menuitem", { name: /Load run/ })).not.toBeInTheDocument();
  });
});

describe("CanvasToolbar at the compact density", () => {
  const initialScrollWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollWidth",
  );
  const initialClientWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  );

  // jsdom has no layout, so the bar's own measure always reads zero. Forcing
  // "twice as wide as it was given" walks the same step-down loop the real
  // element runs at a narrow canvas width.
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get: () => 1000,
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 100,
    });
  });

  afterEach(() => {
    if (initialScrollWidth) {
      Object.defineProperty(HTMLElement.prototype, "scrollWidth", initialScrollWidth);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollWidth");
    }
    if (initialClientWidth) {
      Object.defineProperty(HTMLElement.prototype, "clientWidth", initialClientWidth);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
    }
  });

  it("keeps Save and Run, folds structure into the menu and collapses the environment picker", async () => {
    renderToolbar({
      environments: [{ environmentId: "env-prod", name: "Production" }],
      selectedEnvironment: "env-prod",
    });

    await waitFor(() =>
      expect(screen.getByRole("toolbar")).toHaveAttribute(
        "data-density",
        "compact",
      ),
    );
    expect(screen.queryByRole("button", { name: "Frame selection" })).toBeNull();

    const environment = screen.getByRole("button", { name: "Environment: Production" });
    expect(environment.textContent).toBe("");

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(
      screen.getByRole("menuitem", { name: /^Undo/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /^Frame selection/ }),
    ).toBeInTheDocument();
  });

  it("keeps the More actions glyph from being squeezed by Button padding", () => {
    renderToolbar();

    const trigger = screen.getByRole("button", { name: "More actions" });
    // A plain `p-0` loses to Button's `px-3`, leaving an 8px content box that
    // shrinks the 16px icon. The important variant keeps the siblings' size.
    expect(trigger).toHaveClass("p-0!");
    expect(trigger.querySelector("svg")).toHaveClass("h-4", "w-4");
  });

  it("does not draw a mouse-focus outline around its menus", async () => {
    const user = userEvent.setup();
    renderToolbar();

    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(
      await screen.findByRole("menu", { name: "More actions" }),
    ).toHaveClass("focus:outline-hidden");

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Run options" }));
    expect(
      await screen.findByRole("menu", { name: "Run options" }),
    ).toHaveClass("focus:outline-hidden");
  });
});
