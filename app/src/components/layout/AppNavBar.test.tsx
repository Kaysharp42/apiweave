import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppNavBar } from "./AppNavBar";

const workspaceContext = vi.hoisted(() => ({
  currentOrg: { slug: "personal" },
  currentWorkspace: { slug: "personal" } as { slug: string } | null,
}));

vi.mock("../../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    currentOrg: workspaceContext.currentOrg,
    currentWorkspace: workspaceContext.currentWorkspace,
  }),
}));

vi.mock("../../auth/useAuth", () => ({
  useAuth: () => ({
    isSingleUser: true,
  }),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

describe("AppNavBar settings navigation", () => {
  function renderNav() {
    render(
      <MemoryRouter initialEntries={["/personal/personal/workflows"]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <AppNavBar />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("leaves settings using the route workspace slug while context is still loading", async () => {
    const user = userEvent.setup();
    workspaceContext.currentWorkspace = null;
    render(
      <MemoryRouter initialEntries={["/personal/personal/settings/environments"]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <AppNavBar />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Workflows" }));

    expect(screen.getByTestId("location-probe").textContent).toBe(
      "/personal/personal/workflows",
    );
    workspaceContext.currentWorkspace = { slug: "personal" };
  });

  it("opens MCP from settings without falling onto the malformed workflows slug", async () => {
    const user = userEvent.setup();
    workspaceContext.currentWorkspace = null;
    render(
      <MemoryRouter initialEntries={["/personal/personal/settings/environments"]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <AppNavBar />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "MCP" }));

    expect(screen.getByTestId("location-probe").textContent).toBe(
      "/personal/personal/workflows",
    );
    workspaceContext.currentWorkspace = { slug: "personal" };
  });

  it("routes Settings to workspace environments", async () => {
    const user = userEvent.setup();
    workspaceContext.currentWorkspace = { slug: "personal" };
    renderNav();

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByTestId("location-probe").textContent).toBe(
      "/personal/personal/settings/environments",
    );
  });
});
