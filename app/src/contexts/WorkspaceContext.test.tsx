import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  WorkspaceProvider,
  useWorkspace,
} from "./WorkspaceContext";
import type { Workspace } from "../types/Workspace";

const listWorkspaces = vi.fn();

vi.mock("../utils/apiweaveClient", () => ({
  apiweave: { workspaces: { list: () => listWorkspaces() } },
}));

const workspaces: Workspace[] = [
  {
    workspaceId: "ws-personal",
    slug: "personal",
    name: "Personal",
    description: null,
    isPersonal: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    workspaceId: "ws-team",
    slug: "team-alpha",
    name: "Team Alpha",
    description: null,
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
  beforeEach(() => {
    listWorkspaces.mockReset();
  });

  it("resolves non-personal workspaces from the route and switches with a two-segment path", async () => {
    listWorkspaces.mockResolvedValue(workspaces);
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

  /**
   * The reported bug: a workspace an agent created while the app was running was
   * not in the list this provider had loaded, so Settings → Secrets rendered
   * "Workspace unavailable" until the app was restarted. A miss is not proof the
   * workspace is gone, so it refetches once instead of settling on null.
   */
  it("picks up a workspace the first load did not include when the route names it", async () => {
    // Loaded before the agent's create landed, so the notice was missed.
    listWorkspaces
      .mockResolvedValueOnce([workspaces[0]])
      .mockResolvedValue(workspaces);

    render(
      <MemoryRouter initialEntries={["/personal/team-alpha/workflows"]}>
        <Routes>
          <Route
            path="/:orgSlug/:workspaceSlug/workflows"
            element={
              <WorkspaceProvider>
                <WorkspaceConsumer />
              </WorkspaceProvider>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("workspace-slug")).toHaveTextContent(
        "team-alpha",
      ),
    );
    expect(listWorkspaces).toHaveBeenCalledTimes(2);
  });

  it("retries a missing workspace once, not in a loop", async () => {
    listWorkspaces.mockResolvedValue([workspaces[0]]);

    render(
      <MemoryRouter initialEntries={["/personal/ghost/workflows"]}>
        <Routes>
          <Route
            path="/:orgSlug/:workspaceSlug/workflows"
            element={
              <WorkspaceProvider>
                <WorkspaceConsumer />
              </WorkspaceProvider>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(listWorkspaces).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId("workspace-slug")).toHaveTextContent("none"),
    );
    expect(listWorkspaces).toHaveBeenCalledTimes(2);
  });
});
