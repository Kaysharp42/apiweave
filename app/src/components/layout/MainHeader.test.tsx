import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MainHeader } from "./MainHeader";
import { AppContext } from "../../App";

vi.mock("../../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    currentOrg: { slug: "personal" },
    currentWorkspace: { slug: "personal" },
  }),
}));

vi.mock("./AccountMenu", () => ({
  AccountMenu: () => <div data-testid="account-menu" />,
}));

vi.mock("../../stores/WindowChromeStore", () => ({
  useOwnWindowChrome: () => false,
}));

vi.mock("./WindowControls", () => ({
  WindowControls: () => null,
  dragStyle: {},
  noDragStyle: {},
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

function renderHeader() {
  render(
    <AppContext.Provider
      value={{
        darkMode: false,
        setDarkMode: vi.fn(),
        autoSaveEnabled: true,
        setAutoSaveEnabled: vi.fn(),
      }}
    >
      <MemoryRouter initialEntries={["/personal/personal/workflows"]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <MainHeader />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </AppContext.Provider>,
  );
}

describe("MainHeader tutorial entry", () => {
  it("exposes an accessible Tutorials action", () => {
    renderHeader();
    expect(
      screen.getByRole("button", { name: "Tutorials" }),
    ).toBeInTheDocument();
  });

  it("navigates to the workspace tutorials route", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole("button", { name: "Tutorials" }));

    expect(screen.getByTestId("location-probe").textContent).toBe(
      "/personal/personal/tutorials",
    );
  });
});
