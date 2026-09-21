import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { AppSettingsPage } from "../AppSettingsPage";

// The panels talk to main over IPC; this page's job is only picking one.
vi.mock("../../components/organisms/AgentsSettingsPanel", () => ({
  AgentsSettingsPanel: () => <div>agents panel</div>,
}));
vi.mock("../../components/organisms/McpSetupPanel", () => ({
  McpSetupPanel: () => <div>mcp panel</div>,
}));
vi.mock("../../components/organisms/UpdateSettingsPanel", () => ({
  UpdateSettingsPanel: () => <div>updates panel</div>,
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/:orgSlug/:workspaceSlug/settings/:section"
          element={<AppSettingsPage />}
        />
        <Route
          path="/:orgSlug/:workspaceSlug/settings/environments"
          element={<div>environments page</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppSettingsPage", () => {
  it.each([
    ["agents", "Agents", "agents panel"],
    ["mcp-server", "MCP Server", "mcp panel"],
    ["updates", "Updates", "updates panel"],
  ])("renders %s as a page", (section, heading, panel) => {
    renderAt(`/personal/personal/settings/${section}`);

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByText(panel)).toBeInTheDocument();
  });

  it.each(["nope", "private-networks"])(
    "sends the removed or unknown %s section to Environments",
    (section) => {
      renderAt(`/personal/personal/settings/${section}`);

      expect(screen.getByText("environments page")).toBeInTheDocument();
    },
  );
});
