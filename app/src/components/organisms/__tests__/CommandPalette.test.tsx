import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "../CommandPalette";
import useCanvasStore from "../../../stores/CanvasStore";
import useTabStore from "../../../stores/TabStore";
import { apiweave } from "../../../utils/apiweaveClient";
import type { CanvasCommand } from "../../../types/CanvasCommand";
import type { Workflow } from "../../../types/Workflow";

vi.mock("../../../utils/apiweaveClient", () => ({
  apiweave: {
    workflows: {
      get: vi.fn(),
      search: vi.fn(),
      searchWorkspaceNodes: vi.fn(),
    },
  },
}));

// jsdom has no ResizeObserver; Headless UI's combobox observes the input as results change.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

const run = vi.fn();
const commands: CanvasCommand[] = [
  {
    id: "workflow.save",
    title: "Save workflow",
    group: "Workflow",
    keywords: ["save", "persist"],
    when: () => true,
    run,
  },
  {
    id: "workflow.run",
    title: "Run workflow",
    group: "Workflow",
    keywords: ["run", "execute"],
    when: () => false,
    run: vi.fn(),
  },
];

const summary = {
  workflowId: "wf-users",
  workspaceId: "ws-1",
  name: "Users API",
  description: null,
  rev: 1,
  collectionId: null,
  selectedEnvironmentId: null,
  tags: [],
  nodeCount: 3,
  edgeCount: 2,
  updatedAt: "2026-10-01T00:00:00.000Z",
};

const nodeMatch = {
  workflowId: "wf-orders",
  workflowName: "Orders",
  nodeId: "list-users",
  type: "http-request",
  label: "List users",
  method: "GET",
  urlPath: "/users",
  matchedOn: ["label", "urlPath"],
};

describe("CommandPalette", () => {
  beforeEach(() => {
    vi.mocked(apiweave.workflows.search).mockReset().mockResolvedValue({
      items: [summary],
      nextCursor: null,
    });
    vi.mocked(apiweave.workflows.searchWorkspaceNodes)
      .mockReset()
      .mockResolvedValue({
        query: "users",
        items: [nodeMatch],
        totalMatched: 1,
        omittedMatchCount: 0,
      });
    vi.mocked(apiweave.workflows.get).mockReset();
    useCanvasStore.setState({ pendingFocus: null });
    useTabStore.setState({ tabs: [], activeTabIdByWorkspace: {} });
  });

  it("only shows available commands and runs a selected command", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <CommandPalette open commands={commands} workspaceId="ws-1" onClose={onClose} />,
    );

    expect(screen.getByText("Save workflow")).toBeInTheDocument();
    expect(screen.queryByText("Run workflow")).not.toBeInTheDocument();

    await user.click(screen.getByText("Save workflow"));

    expect(run).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("filters commands by title and keywords", async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette open commands={commands} workspaceId="ws-1" onClose={vi.fn()} />,
    );

    await user.type(screen.getByRole("combobox"), "persist");

    expect(screen.getByText("Save workflow")).toBeInTheDocument();
  });

  it("searches workflows and nodes once typing pauses, and marks the match", async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette open commands={commands} workspaceId="ws-1" onClose={vi.fn()} />,
    );

    await user.type(screen.getByRole("combobox"), "users");

    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Users APIWorkflow",
      "List usersGET /usersOrders",
    ]);
    // Debounced: one search for the whole word, not one per keystroke.
    expect(apiweave.workflows.search).toHaveBeenCalledOnce();
    expect(apiweave.workflows.search).toHaveBeenCalledWith("ws-1", "users", 5);
    expect(apiweave.workflows.searchWorkspaceNodes).toHaveBeenCalledWith(
      "ws-1",
      "users",
      10,
    );
    expect(
      [...document.querySelectorAll("mark")].map((mark) => mark.textContent),
    ).toEqual(["Users", "users", "users"]);
  });

  it("opens a node's workflow and asks its canvas to focus the node, from the keyboard", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const workflow = {
      workflowId: "wf-orders",
      workspaceId: "ws-1",
      name: "Orders",
    } as Workflow;
    vi.mocked(apiweave.workflows.get).mockResolvedValue(workflow);
    render(
      <CommandPalette open commands={[]} workspaceId="ws-1" onClose={onClose} />,
    );

    await user.type(screen.getByRole("combobox"), "users");
    await screen.findByText("Orders");
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(onClose).toHaveBeenCalledOnce();
    expect(useCanvasStore.getState().pendingFocus).toEqual({
      workflowId: "wf-orders",
      nodeId: "list-users",
    });
    await waitFor(() =>
      expect(useTabStore.getState().activeTabIdByWorkspace["ws-1"]).toBe(
        "wf-orders",
      ),
    );
    expect(apiweave.workflows.get).toHaveBeenCalledWith("ws-1", "wf-orders");
  });

  it("switches to an already open workflow without fetching it", async () => {
    const user = userEvent.setup();
    useTabStore.getState().openTab({
      workflowId: "wf-users",
      workspaceId: "ws-1",
      name: "Users API",
    } as Workflow);
    useTabStore.getState().openTab({
      workflowId: "wf-other",
      workspaceId: "ws-1",
      name: "Other",
    } as Workflow);
    render(
      <CommandPalette open commands={[]} workspaceId="ws-1" onClose={vi.fn()} />,
    );

    await user.type(screen.getByRole("combobox"), "users");
    await user.click(await screen.findByText("API", { exact: false }));

    expect(useTabStore.getState().activeTabIdByWorkspace["ws-1"]).toBe("wf-users");
    expect(apiweave.workflows.get).not.toHaveBeenCalled();
  });

  it("does not search a single character", async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette open commands={commands} workspaceId="ws-1" onClose={vi.fn()} />,
    );

    await user.type(screen.getByRole("combobox"), "u");
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(apiweave.workflows.search).not.toHaveBeenCalled();
  });
});
