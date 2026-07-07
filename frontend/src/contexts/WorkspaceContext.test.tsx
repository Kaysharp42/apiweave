import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  WorkspaceProvider,
  useWorkspace,
} from "./WorkspaceContext";
import type { Workspace } from "../types/Workspace";

const authenticatedJson = vi.fn();

vi.mock("../utils/apiweaveClient", () => ({
  authenticatedJson: (...args: unknown[]) => authenticatedJson(...args),
  default: "ipc://apiweave",
}));

const workspaces: Workspace[] = [
  {
    workspaceId: "ws-personal",
    slug: "personal",
    name: "Personal",
    description: null,
    ownerType: "user",
    ownerUserId: "user-1",
    isPersonal: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    workspaceId: "ws-team",
    slug: "team-alpha",
    name: "Team Alpha",
    description: null,
    ownerType: "user",
    ownerUserId: "user-1",
    isPersonal: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

function WorkspaceConsumer() {
  const { currentWorkspace, switchTo, isLoading } = useWorkspace();

  if (isLoading) {
    return <div>Loading</div>;
  }

  return (
    <>
      <div data-testid="workspace-slug">{currentWorkspace?.slug ?? "none"}</div>
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
});
