import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MainHeader } from "./MainHeader";
import { AppContext } from "../../App";
import { installGitBridge, trackedStatus, untrackedStatus } from "../../__tests__/gitFixtures";

vi.mock("../../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    currentOrg: { slug: "personal" },
    currentWorkspace: { workspaceId: "ws-1", slug: "personal" },
  }),
}));

vi.mock("../../stores/WindowChromeStore", () => ({
  useOwnWindowChrome: () => false,
}));

vi.mock("./WindowControls", () => ({
  WindowControls: () => null,
  dragStyle: {},
  noDragStyle: {},
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe("MainHeader sync status", () => {
  it("shows the current workspace's sync state when it is tracked", async () => {
    installGitBridge(trackedStatus({ uncommitted: true }));
    renderHeader();

    expect(
      await screen.findByRole("button", { name: "Version history: Pending" }),
    ).toBeInTheDocument();
  });

  it("shows none for a workspace that is not tracked", async () => {
    const { bridge } = installGitBridge(untrackedStatus);
    renderHeader();

    await vi.waitFor(() => expect(bridge.status).toHaveBeenCalledWith("ws-1"));
    expect(screen.queryByRole("button", { name: /^Version history/ })).toBeNull();
  });

  it("follows its workspace through the one shared status feed", async () => {
    const { bridge, subscriptions } = installGitBridge(trackedStatus());
    renderHeader();

    await screen.findByRole("button", { name: "Version history: Synced" });
    // The accounts menu's sync badge reads the same feed, not a second one.
    expect(screen.getByRole("button", { name: "Git accounts — Synced" })).toBeInTheDocument();
    expect(bridge.status).toHaveBeenCalledTimes(1);
    expect(subscriptions()).toBe(1);
  });
});
