import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  WorkspaceProvider,
  useWorkspace,
} from "./WorkspaceContext";
import type { Workspace } from "../types/Workspace";

const authenticatedJson = vi.fn();
const onCloudStatusChanged = vi.fn(
  (_callback: () => void): (() => void) => () => undefined,
);

vi.mock("../utils/apiweaveClient", () => ({
  authenticatedJson: (...args: unknown[]) => authenticatedJson(...args),
  onCloudStatusChanged: (callback: () => void) =>
    onCloudStatusChanged(callback),
  default: "ipc://apiweave",
}));

const workspaces: Workspace[] = [
  {
    workspaceId: "ws-personal",
    slug: "personal",
    name: "Personal",
    description: null,
    origin: "local",
    syncMode: "none",
    isPersonal: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    workspaceId: "ws-team",
    slug: "team-alpha",
    name: "Team Alpha",
    description: null,
    origin: "local",
    syncMode: "none",
    isPersonal: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

function WorkspaceConsumer() {
  const { availableWorkspaces, currentWorkspace, switchTo, isLoading } =
    useWorkspace();

  if (isLoading) {
    return <div>Loading</div>;
  }

  return (
    <>
      <div data-testid="workspace-slug">{currentWorkspace?.slug ?? "none"}</div>
      <div data-testid="workspace-count">{availableWorkspaces.length}</div>
      <button type="button" onClick={() => switchTo("team-alpha")}>Switch</button>
    </>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

describe("WorkspaceContext routing", () => {
  it("resolves non-personal workspaces from the route and switches with a two-segment path", async () => {
    authenticatedJson.mockResolvedValue({ workspaces, total: workspaces.length });
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/personal/team-alpha/workflows"]}>
        <Routes>
          <Route
            path="/:orgSlug/:workspaceSlug/workflows"
            element={
              <WorkspaceProvider>
                <WorkspaceConsumer />
                <LocationProbe />
              </WorkspaceProvider>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("workspace-slug")).toHaveTextContent(
      "team-alpha",
    );

    await user.click(screen.getByRole("button", { name: "Switch" }));

    expect(screen.getByTestId("location-probe")).toHaveTextContent(
      "/personal/team-alpha/workflows",
    );
  });

  it("refreshes available workspaces when cloud sync changes local data", async () => {
    authenticatedJson.mockResolvedValue({ workspaces, total: workspaces.length });

    render(
      <MemoryRouter initialEntries={["/personal/workflows"]}>
        <Routes>
          <Route
            path="/:workspaceSlug/workflows"
            element={
              <WorkspaceProvider>
                <WorkspaceConsumer />
              </WorkspaceProvider>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("workspace-count")).toHaveTextContent("2");

    const cloudWorkspace: Workspace = {
      ...workspaces[1]!,
      workspaceId: "ws-cloud",
      slug: "ws-cloud",
      name: "Cloud workspace",
    };
    authenticatedJson.mockResolvedValue({
      workspaces: [...workspaces, cloudWorkspace],
      total: workspaces.length + 1,
    });

    const listener = onCloudStatusChanged.mock.calls.at(-1)?.[0];
    expect(listener).toBeDefined();
    act(() => listener?.());

    await waitFor(() =>
      expect(screen.getByTestId("workspace-count")).toHaveTextContent("3"),
    );
  });
});
