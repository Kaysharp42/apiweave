import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsContent } from "./SettingsContent";

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

vi.mock("../../organisms/McpSetupModal", () => ({
  McpSetupModal: () => null,
}));

describe("SettingsContent workspace routes", () => {
  it("uses the route workspace slug when context is still loading", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onSwitchNav = vi.fn();

    render(
      <MemoryRouter initialEntries={["/personal/personal/settings/environments"]}>
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
      </MemoryRouter>,
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
});
