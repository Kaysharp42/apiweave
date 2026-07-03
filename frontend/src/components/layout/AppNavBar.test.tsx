import { describe, expect, it, beforeEach, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppNavBar } from "./AppNavBar";

vi.mock("../../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    currentOrg: { slug: "personal" },
    currentWorkspace: { slug: "personal" },
  }),
}));

const authState = vi.hoisted(() => ({
  isSingleUser: true,
  canInvite: false,
}));

vi.mock("../../auth/useAuth", () => ({
  useAuth: () => ({
    isSingleUser: authState.isSingleUser,
    hasPermission: (perm: string) =>
      perm === "users:invite" ? authState.canInvite : false,
  }),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

describe("AppNavBar settings navigation", () => {
  beforeEach(() => {
    localStorage.clear();
    authState.isSingleUser = true;
    authState.canInvite = false;
  });

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

  it("routes Settings to workspace environments in single_user mode", async () => {
    const user = userEvent.setup();
    renderNav();

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByTestId("location-probe").textContent).toBe(
      "/personal/personal/settings/environments",
    );
  });

  it("routes Settings to workspace settings (not the admin page) for a non-admin in multi_tenant mode", async () => {
    authState.isSingleUser = false;
    authState.canInvite = false;
    const user = userEvent.setup();
    renderNav();

    await user.click(screen.getByRole("button", { name: "Settings" }));

    // Must NOT land on /settings/users (AdminRoute would bounce → workflows).
    expect(screen.getByTestId("location-probe").textContent).toBe(
      "/personal/personal/settings/environments",
    );
  });

  it("routes Settings to the admin page for an admin in multi_tenant mode", async () => {
    authState.isSingleUser = false;
    authState.canInvite = true;
    const user = userEvent.setup();
    renderNav();

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByTestId("location-probe").textContent).toBe(
      "/settings/users",
    );
  });
});
