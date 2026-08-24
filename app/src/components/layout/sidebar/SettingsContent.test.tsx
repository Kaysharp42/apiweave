import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsContent } from "./SettingsContent";
import { UpdateStatusProvider } from "../../../contexts/UpdateStatusContext";

const workspaceContext = vi.hoisted(() => ({
  currentOrg: null as { slug?: string } | null,
  currentWorkspace: null as { slug?: string } | null,
}));

vi.mock("../../../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    currentOrg: workspaceContext.currentOrg,
    currentWorkspace: workspaceContext.currentWorkspace,
  }),
}));

describe("SettingsContent workspace routes", () => {
  it("uses the route workspace slug when context is still loading", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onSwitchNav = vi.fn();

    render(
      // The panel shows the update marker, so it reads the shared context that
      // owns the one IPC subscription.
      <UpdateStatusProvider>
        <MemoryRouter
          initialEntries={["/personal/personal/settings/environments"]}
        >
          <Routes>
            <Route
              path="/:orgSlug/:workspaceSlug/settings/environments"
              element={
                <SettingsContent
                  onNavigate={onNavigate}
                  onSwitchNav={onSwitchNav}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      </UpdateStatusProvider>,
    );

    await user.click(screen.getByRole("button", { name: /Projects/i }));
    expect(onSwitchNav).toHaveBeenCalledWith("projects");
    expect(onNavigate).toHaveBeenCalledWith("/personal/personal/workflows");

    await user.click(screen.getByRole("button", { name: /Environments/i }));
    expect(onNavigate).toHaveBeenCalledWith(
      "/personal/personal/settings/environments",
    );

    await user.click(screen.getByRole("button", { name: /Secrets/i }));
    expect(onNavigate).toHaveBeenCalledWith(
      "/personal/personal/settings/secrets",
    );
  });

  // Every app-scoped row used to open a dialog over whatever page was already
  // showing. They are pages now, so the sidebar only ever navigates.
  // Anchored: "MCP Server / Let agents drive your workflows" also contains
  // "agents", so an unanchored /Agents/i matches two rows.
  it.each([
    [/^Agents/, "/personal/personal/settings/agents"],
    [/^Private networks/, "/personal/personal/settings/private-networks"],
    [/^MCP Server/, "/personal/personal/settings/mcp-server"],
    [/^Updates/, "/personal/personal/settings/updates"],
  ])("navigates to %s", async (name, path) => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <UpdateStatusProvider>
        <MemoryRouter initialEntries={["/personal/personal/settings/agents"]}>
          <Routes>
            <Route
              path="/:orgSlug/:workspaceSlug/settings/:section"
              element={
                <SettingsContent
                  onNavigate={onNavigate}
                  onSwitchNav={vi.fn()}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      </UpdateStatusProvider>,
    );

    await user.click(screen.getByRole("button", { name }));
    expect(onNavigate).toHaveBeenCalledWith(path);
  });
});
