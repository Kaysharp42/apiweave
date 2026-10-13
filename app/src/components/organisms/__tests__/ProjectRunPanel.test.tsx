// @vitest-environment jsdom
import "../../../__tests__/setup";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectRun } from "@shared/types/ProjectRun";

type Listener = (run: ProjectRun) => void;

const { apiMock, listeners } = vi.hoisted(() => ({
  apiMock: {
    projects: {
      listRuns: vi.fn(),
      run: vi.fn(),
      cancelRun: vi.fn(),
      runReport: vi.fn(),
    },
    environments: { list: vi.fn() },
  },
  listeners: [] as ((run: ProjectRun) => void)[],
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("../../../utils/downloadFile", () => ({ downloadReport: vi.fn() }));
vi.mock("../../../utils/apiweaveClient", () => ({
  apiweave: apiMock,
  onProjectRunChanged: (callback: Listener) => {
    listeners.push(callback);
    return () => listeners.splice(listeners.indexOf(callback), 1);
  },
}));

import { ProjectRunPanel } from "../ProjectRunPanel";
import { downloadReport } from "../../../utils/downloadFile";
import useEnvironmentStore from "../../../stores/EnvironmentStore";

function projectRun(overrides: Partial<ProjectRun> = {}): ProjectRun {
  return {
    projectRunId: "pr-1",
    projectId: "p-1",
    environmentId: "env-staging",
    status: "running",
    startedAt: "2026-10-07T10:00:00.000Z",
    finishedAt: null,
    items: [
      { workflowId: "wf-auth", workflowName: "Auth", continueOnFail: true, runId: "run-auth", status: "running", durationMs: null },
      { workflowId: "wf-pay", workflowName: "Pay", continueOnFail: false, runId: null, status: "pending", durationMs: null },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  listeners.length = 0;
  useEnvironmentStore.setState({ environments: [], loadedWorkspaceId: null });
  apiMock.environments.list.mockResolvedValue({
    items: [
      { environmentId: "env-dev", name: "dev", isDefault: false },
      { environmentId: "env-staging", name: "staging", isDefault: true },
    ],
    total: 2,
  });
  apiMock.projects.listRuns.mockResolvedValue({ items: [], total: 0 });
  apiMock.projects.run.mockResolvedValue(projectRun());
  apiMock.projects.cancelRun.mockResolvedValue(projectRun());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectRunPanel", () => {
  it("exports a finished project run's report, and offers none while it runs", async () => {
    apiMock.projects.listRuns.mockResolvedValue({ items: [projectRun({ status: "failed" })], total: 1 });
    apiMock.projects.runReport.mockResolvedValue("<testsuites/>");
    render(<ProjectRunPanel workspaceId="ws-1" projectId="p-1" onOpenRun={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: /JUnit XML/ }));
    expect(apiMock.projects.runReport).toHaveBeenCalledWith("ws-1", "pr-1", "junit");
    await waitFor(() =>
      expect(downloadReport).toHaveBeenCalledWith("apiweave-project-run-pr-1", "junit", "<testsuites/>"),
    );

    act(() => listeners.forEach((listener) => listener(projectRun({ status: "running" }))));
    expect(screen.queryByRole("button", { name: /JUnit XML/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /HTML report/ })).toBeNull();
  });

  it("runs against the workspace default environment, follows progress live, and opens a workflow's run", async () => {
    const onOpenRun = vi.fn();
    render(<ProjectRunPanel workspaceId="ws-1" projectId="p-1" onOpenRun={onOpenRun} />);
    const select = await screen.findByLabelText("Environment for the project run");
    await waitFor(() => expect(select).toHaveValue("env-staging"));

    await userEvent.click(screen.getByRole("button", { name: /Run project/ }));
    expect(apiMock.projects.run).toHaveBeenCalledWith("ws-1", "p-1", "env-staging");

    const list = await screen.findByRole("region", { name: "Workflows in this project run" });
    expect(within(list).getByText("Auth")).toBeInTheDocument();
    expect(within(list).getByLabelText("Pending")).toBeInTheDocument();
    // One run at a time per project.
    expect(screen.getByRole("button", { name: /Run project/ })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(apiMock.projects.cancelRun).toHaveBeenCalledWith("ws-1", "pr-1");

    act(() => {
      for (const listener of listeners) {
        listener(projectRun({
          status: "failed",
          finishedAt: "2026-10-07T10:00:02.000Z",
          items: [
            { workflowId: "wf-auth", workflowName: "Auth", continueOnFail: false, runId: "run-auth", status: "failed", durationMs: 1200 },
            { workflowId: "wf-pay", workflowName: "Pay", continueOnFail: false, runId: null, status: "skipped", durationMs: null },
          ],
        }));
      }
    });
    expect(within(list).getByLabelText("Failed", { selector: "li [role=status]" })).toBeInTheDocument();
    expect(within(list).getByLabelText("Skipped")).toBeInTheDocument();
    expect(within(list).getByText("1.2s")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancel/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run project/ })).toBeEnabled();

    // Only a workflow that actually ran has a run to open.
    const openButtons = within(list).getAllByRole("button", { name: "Open run" });
    expect(openButtons).toHaveLength(1);
    await userEvent.click(openButtons[0]!);
    expect(onOpenRun).toHaveBeenCalledWith("wf-auth", "run-auth");
  });

  it("runs with no environment when the user picks none, and lists earlier runs to switch between", async () => {
    apiMock.projects.listRuns.mockResolvedValue({
      items: [
        projectRun({ projectRunId: "pr-2", status: "completed", items: [{ workflowId: "wf-auth", workflowName: "Auth", continueOnFail: true, runId: "r2", status: "completed", durationMs: 5 }] }),
        projectRun({ projectRunId: "pr-1", status: "cancelled", environmentId: null, items: [{ workflowId: "wf-auth", workflowName: "Auth", continueOnFail: true, runId: "r1", status: "cancelled", durationMs: 5 }] }),
      ],
      total: 2,
    });
    render(<ProjectRunPanel workspaceId="ws-1" projectId="p-1" onOpenRun={vi.fn()} />);

    const history = await screen.findByRole("region", { name: "Project run history" });
    expect(within(history).getAllByRole("listitem")).toHaveLength(2);
    await userEvent.click(within(history).getByRole("button", { name: /No environment/ }));
    const list = screen.getByRole("region", { name: "Workflows in this project run" });
    expect(within(list).getByLabelText("Cancelled", { selector: "li [role=status]" })).toBeInTheDocument();

    // A change to another project's run is not this panel's business.
    act(() => {
      for (const listener of listeners) listener(projectRun({ projectRunId: "other", projectId: "p-2" }));
    });
    expect(within(history).getAllByRole("listitem")).toHaveLength(2);

    await userEvent.selectOptions(await screen.findByLabelText("Environment for the project run"), "No environment");
    await userEvent.click(screen.getByRole("button", { name: /Run project/ }));
    expect(apiMock.projects.run).toHaveBeenCalledWith("ws-1", "p-1", null);
  });
});
