import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MainHeader } from "./MainHeader";
import { AppContext } from "../../App";

const workspaceContext = vi.hoisted(() => ({
  currentOrg: null as { slug?: string } | null,
  currentWorkspace: null as { slug?: string } | null,
}));

vi.mock("../../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    currentOrg: workspaceContext.currentOrg,
    currentWorkspace: workspaceContext.currentWorkspace,
  }),
}));

vi.mock("../../stores/EnvironmentStore", () => ({
  default: (selector: (state: { environments: never[] }) => unknown) =>
    selector({ environments: [] }),
}));

vi.mock("../../stores/NavigationStore", () => ({
  default: (selector: (state: { toggleMobileSidebar: () => void }) => unknown) =>
    selector({ toggleMobileSidebar: () => undefined }),
}));

vi.mock("./AccountMenu", () => ({
  AccountMenu: () => null,
}));

vi.mock("../organisms/OrgWorkspaceSwitcher", () => ({
  OrgWorkspaceSwitcher: () => null,
}));

function renderHeader() {
  render(
    <AppContext.Provider
      value={{
        darkMode: false,
        setDarkMode: () => undefined,
        autoSaveEnabled: true,
        setAutoSaveEnabled: () => undefined,
      }}
    >
      <MemoryRouter initialEntries={["/personal/personal/workflows"]}>
        <Routes>
          <Route
            path="/:orgSlug/:workspaceSlug/workflows"
            element={<MainHeader />}
          />
        </Routes>
      </MemoryRouter>
    </AppContext.Provider>,
  );
}

describe("MainHeader manage environments route", () => {
  it("uses the current route slug when workspace context is still loading", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(
      screen.getByRole("button", { name: "Select default environment" }),
    );

    expect(screen.getByRole("link", { name: /Manage Environments/i })).toHaveAttribute(
      "href",
      "/personal/personal/settings/environments",
    );
  });
});
