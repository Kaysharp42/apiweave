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
  beforeEach(() => {
    localStorage.clear();
  });

  it("routes Settings to workspace environments in single_user mode", async () => {
    const user = userEvent.setup();

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

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByTestId("location-probe").textContent).toBe(
      "/personal/personal/settings/environments",
    );
  });
});
