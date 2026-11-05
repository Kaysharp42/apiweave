import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectItem } from "../ProjectItem";
import { WorkflowItem } from "../WorkflowItem";
import { WorkflowItemBadges } from "../WorkflowItemBadges";
import { projectRowMenuItems, workflowRowMenuItems } from "../rowContextMenus";
import type { Project, Workflow, WorkflowRowLabels } from "../../../../types";

// jsdom has no ResizeObserver, and the anchored Headless UI menu observes its
// anchor while open.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

vi.mock("@/components/organisms/AgentLaunchButton", () => ({
  AgentLaunchButton: () => <span data-testid="agent-launch" />,
}));

const noop = (): void => undefined;

const PROJECT: Project = {
  id: "project-row",
  collectionId: "project-row",
  projectId: "project-row",
  name: "Checkout",
  workflowCount: 0,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
};

const WORKFLOW: Workflow = {
  workflowId: "workflow-row",
  workspaceId: "workspace-1",
  name: "Place order",
  nodes: [],
  edges: [],
  variables: {},
  tags: [],
  nodeTemplates: [],
  rev: 0,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
};

const LOOSE_WORKFLOW: Workflow = {
  ...WORKFLOW,
  workflowId: "workflow-loose",
  name: "Review order",
  collectionId: null,
};

const LABELS: WorkflowRowLabels = {
  name: "Place order",
  collection: "Checkout",
  environment: null,
};

function renderProjectItem(workflows: Workflow[] = []): void {
  render(
    <ProjectItem
      project={PROJECT}
      isExpanded
      workflows={workflows}
      projects={[PROJECT]}
      environments={[]}
      selectedWorkflowId={null}
      onToggle={noop}
      onWorkflowClick={noop}
      onExportProject={noop}
      onDeleteProject={noop}
      onRenameProject={noop}
      onMoveProjectToWorkspace={noop}
      onExportWorkflow={noop}
      onDeleteWorkflow={noop}
      onRenameWorkflow={noop}
      onMoveWorkflowToProject={noop}
      onMoveWorkflowToWorkspace={noop}
      onAddWorkflowToProject={noop}
      onAssignWorkflowToProject={noop}
    />,
  );
}

function renderWorkflowItem(): void {
  render(
    <WorkflowItem
      workflow={WORKFLOW}
      isActive={false}
      collections={[PROJECT]}
      environments={[]}
      onWorkflowClick={noop}
      onExportWorkflow={noop}
      onDeleteWorkflow={noop}
      onRenameWorkflow={noop}
      onMoveWorkflowToProject={noop}
      onMoveWorkflowToWorkspace={noop}
    />,
  );
}

describe("sidebar row context menus", () => {
  it("ends each menu with a separated destructive delete", () => {
    const workflowItems = workflowRowMenuItems(WORKFLOW, {
      onRenameWorkflow: noop,
      onMoveWorkflowToProject: noop,
      onMoveWorkflowToWorkspace: noop,
      onExportWorkflow: noop,
      onDeleteWorkflow: noop,
    });
    const projectItems = projectRowMenuItems(PROJECT, PROJECT.collectionId, {
      onRenameProject: noop,
      onMoveProjectToWorkspace: noop,
      onAddWorkflowToProject: noop,
      onExportProject: noop,
      onDeleteProject: noop,
    });

    expect(workflowItems.at(-1)).toMatchObject({
      label: "Delete workflow…",
      destructive: true,
      separated: true,
    });
    expect(projectItems.at(-1)).toMatchObject({
      label: "Delete project…",
      destructive: true,
      separated: true,
    });
  });
});

describe("sidebar row inline actions", () => {
  it("keeps destructive delete out of the workflow hover strip", () => {
    renderWorkflowItem();

    expect(
      screen.queryByRole("button", { name: "Delete workflow permanently" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export workflow" }),
    ).toBeInTheDocument();
  });

  it("keeps destructive delete out of the project hover strip", () => {
    renderProjectItem();

    expect(
      screen.queryByRole("button", { name: "Delete project permanently" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export project" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("agent-launch")).toBeInTheDocument();
  });
});

describe("sidebar row keyboard menus", () => {
  it("opens a workflow's menu with Shift+F10", async () => {
    renderWorkflowItem();

    fireEvent.keyDown(screen.getByRole("button", { name: /Place order/ }), {
      key: "F10",
      shiftKey: true,
    });

    const menu = await screen.findByRole("menu", {
      name: 'Workflow "Place order"',
    });
    const items = screen.getAllByRole("menuitem");
    expect(menu).toBeInTheDocument();
    expect(items.at(-1)).toHaveTextContent("Delete workflow…");
  });

  it("opens a project's menu with the ContextMenu key", async () => {
    renderProjectItem();

    fireEvent.keyDown(screen.getByRole("button", { name: /Checkout/ }), {
      key: "ContextMenu",
    });

    expect(
      await screen.findByRole("menu", { name: 'Project "Checkout"' }),
    ).toBeInTheDocument();
  });
});

describe("sidebar row menu highlight", () => {
  it("keeps the project row highlighted while its menu is open", () => {
    renderProjectItem();
    const trigger = screen.getByRole("button", { name: /Checkout/ });

    fireEvent.keyDown(trigger, { key: "ContextMenu" });

    expect(trigger.parentElement).toHaveClass("bg-surface-overlay");
    expect(trigger.parentElement).toHaveClass(
      "dark:bg-surface-dark-overlay",
    );
  });

  it("keeps the workflow row highlighted while its menu is open", () => {
    renderWorkflowItem();
    const trigger = screen.getByRole("button", { name: /Place order/ });

    fireEvent.keyDown(trigger, { key: "ContextMenu" });

    expect(trigger.parentElement).toHaveClass("bg-surface-overlay");
    expect(trigger.parentElement).toHaveClass(
      "dark:bg-surface-dark-overlay",
    );
  });
});

describe("project item assign menu", () => {
  it("lets Headless UI own the anchored height and keeps the list scrollable", async () => {
    const user = userEvent.setup();
    renderProjectItem([LOOSE_WORKFLOW]);

    await user.click(screen.getByRole("button", { name: "Assign" }));

    const menu = (
      await screen.findByRole("menuitem", { name: "Review order" })
    ).closest('[role="menu"]');
    expect(menu).toHaveClass("[--anchor-max-height:10rem]", "w-56");
    expect(menu).toHaveClass("overflow-y-auto");
    expect(menu).not.toHaveClass("max-h-40");
  });

  it("exposes expanded state and closes on Escape", async () => {
    const user = userEvent.setup();
    renderProjectItem([LOOSE_WORKFLOW]);

    const trigger = screen.getByRole("button", { name: "Assign" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      await screen.findByRole("menuitem", { name: "Review order" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(trigger).toHaveAttribute("aria-expanded", "false"),
    );
  });
});

describe("project item empty state", () => {
  it("folds the empty message into the Add workflow row", () => {
    renderProjectItem();

    expect(screen.getByText("No workflows yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add workflow" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No workflows in this project"),
    ).not.toBeInTheDocument();
  });

  it("truncates the message instead of pushing the actions out of the sidebar", () => {
    renderProjectItem([LOOSE_WORKFLOW]);

    const message = screen.getByText("No workflows yet");
    expect(message).toHaveClass("min-w-0", "truncate");
    expect(message).not.toHaveClass("shrink-0");

    const add = screen.getByRole("button", { name: "Add workflow" });
    expect(add).toHaveClass("shrink-0", "whitespace-nowrap");

    const assign = screen.getByRole("button", { name: "Assign" });
    expect(assign).toHaveClass("shrink-0", "whitespace-nowrap");

    expect(message.closest("ul")).toHaveClass("overflow-x-hidden");
  });
});

describe("WorkflowItemBadges", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders project metadata in a neutral badge", () => {
    render(<WorkflowItemBadges nodeCount={3} labels={LABELS} />);

    const projectBadge = screen.getByTitle("Checkout");
    expect(projectBadge).toHaveClass("text-text-secondary");
    expect(projectBadge).not.toHaveClass("text-status-info");
  });

  it("keeps the metadata on one non-wrapping line", () => {
    const { container } = render(
      <WorkflowItemBadges nodeCount={3} labels={LABELS} />,
    );

    const line = container.firstElementChild as HTMLElement;
    expect(line).toHaveClass("whitespace-nowrap");
    expect(line).not.toHaveClass("flex-wrap");
    expect(screen.getByText("3 nodes")).toHaveClass("shrink-0");
  });
});
