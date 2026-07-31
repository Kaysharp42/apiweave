import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddNodesPanel from "../AddNodesPanel";
import { PaletteProvider } from "../../contexts/PaletteContext";
import useNodePresetStore from "../../stores/NodePresetStore";
import type { NodePreset } from "../../types/NodePreset";

// ---------------------------------------------------------------------------
// Mocks — the panel reaches IPC only through the preset store's client calls.
// ---------------------------------------------------------------------------

const mockList = vi.fn();
const mockDelete = vi.fn();

vi.mock("../../utils/apiweaveClient", () => ({
  default: "ipc://apiweave",
  apiweave: {
    nodePresets: {
      list: (...args: unknown[]) => mockList(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
    },
  },
}));

function preset(overrides: Partial<NodePreset> = {}): NodePreset {
  return {
    presetId: "preset-1",
    workspaceId: "ws-1",
    name: "Standard auth headers",
    nodeType: "http-request",
    config: { method: "POST", headers: [{ key: "Authorization", value: "Bearer x" }] },
    rev: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function openPalette() {
  await userEvent.click(screen.getByLabelText("Add nodes"));
}

/**
 * Scoped to the "Saved Presets" collapse — the built-in palette already has a
 * "POST Request" item and a "Delay" item, so an unscoped getByText would match
 * those instead of the preset under test.
 */
function savedPresetsSection(): HTMLElement {
  const section = screen.getByText("Saved Presets").closest(".collapse");
  if (!(section instanceof HTMLElement)) {
    throw new Error("Saved Presets section not rendered");
  }
  return section;
}

function renderPanel(workspaceId = "ws-1") {
  return render(
    <PaletteProvider>
      <AddNodesPanel workspaceId={workspaceId} />
    </PaletteProvider>,
  );
}

describe("AddNodesPanel — saved presets section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNodePresetStore.setState({
      presets: [],
      isLoading: false,
      loadedWorkspaceId: null,
      loadError: null,
    });
    mockList.mockResolvedValue({ items: [], total: 0 });
    mockDelete.mockResolvedValue(null);
  });

  it("loads the workspace's presets on mount", async () => {
    renderPanel();
    await waitFor(() => expect(mockList).toHaveBeenCalledWith("ws-1"));
  });

  it("does not call IPC when there is no workspace yet", async () => {
    renderPanel("");
    await openPalette();
    expect(mockList).not.toHaveBeenCalled();
    expect(screen.queryByText("Saved Presets")).not.toBeInTheDocument();
  });

  it("renders a saved preset with its node-type label and method badge", async () => {
    mockList.mockResolvedValue({ items: [preset()], total: 1 });
    renderPanel();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await openPalette();

    const section = within(savedPresetsSection());
    expect(section.getByText("Standard auth headers")).toBeInTheDocument();
    expect(section.getByText("HTTP Request")).toBeInTheDocument();
    expect(section.getByText("POST")).toBeInTheDocument();
  });

  it("omits the method badge for non-http preset types", async () => {
    mockList.mockResolvedValue({
      items: [preset({ nodeType: "delay", name: "Always wait", config: { duration: 500 } })],
      total: 1,
    });
    renderPanel();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await openPalette();

    const section = within(savedPresetsSection());
    expect(section.getByText("Always wait")).toBeInTheDocument();
    expect(section.getByText("Delay")).toBeInTheDocument();
    expect(section.queryByText("POST")).not.toBeInTheDocument();
  });

  it("deletes a preset through the store and drops it from the list", async () => {
    mockList.mockResolvedValue({ items: [preset()], total: 1 });
    renderPanel();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await openPalette();

    await userEvent.click(
      screen.getByLabelText("Delete preset Standard auth headers"),
    );

    await waitFor(() =>
      expect(mockDelete).toHaveBeenCalledWith("ws-1", "preset-1"),
    );
    await waitFor(() =>
      expect(screen.queryByText("Standard auth headers")).not.toBeInTheDocument(),
    );
  });

  it("offers no delete affordance on the built-in node templates", async () => {
    renderPanel();
    await openPalette();

    expect(screen.getByText("GET Request")).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/^Delete preset/),
    ).not.toBeInTheDocument();
  });
});
