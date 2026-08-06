import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppNavBar } from "./AppNavBar";
import { UpdateStatusProvider } from "../../contexts/UpdateStatusContext";
import type { UpdateStatus } from "@shared/types/UpdateStatus";

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

/**
 * The nav bar reads its update marker from the shared context, so every case
 * needs the provider that owns the one IPC subscription — including the
 * navigation ones that have nothing to do with updates.
 */
function renderNavAt(entry: string) {
  render(
    <UpdateStatusProvider>
      <MemoryRouter initialEntries={[entry]}>
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
      </MemoryRouter>
    </UpdateStatusProvider>,
  );
}

describe("AppNavBar settings navigation", () => {
  function renderNav() {
    renderNavAt("/personal/personal/workflows");
  }

  it("leaves settings using the route workspace slug while context is still loading", async () => {
    const user = userEvent.setup();
    workspaceContext.currentWorkspace = null;
    renderNavAt("/personal/personal/settings/environments");

    await user.click(screen.getByRole("button", { name: "Workflows" }));

    expect(screen.getByTestId("location-probe").textContent).toBe(
      "/personal/personal/workflows",
    );
    workspaceContext.currentWorkspace = { slug: "personal" };
  });

  it("opens MCP from settings without falling onto the malformed workflows slug", async () => {
    const user = userEvent.setup();
    workspaceContext.currentWorkspace = null;
    renderNavAt("/personal/personal/settings/environments");

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

/**
 * Settings > Updates is the only screen that shows the update flow, so the
 * nav marker is the sole thing that tells a user on a platform that can't
 * self-install (macOS, deb/rpm/pacman) that a release exists at all.
 */
describe("AppNavBar update marker", () => {
  const baseStatus: UpdateStatus = {
    state: "idle",
    currentVersion: "0.6.3",
    latestVersion: null,
    releaseUrl: null,
    downloadProgressPercent: null,
    supportsAutoInstall: false,
    policy: "notify",
    lastCheckedAt: null,
    error: null,
  };

  function installBridge(initial: UpdateStatus) {
    const listeners = new Set<(status: UpdateStatus) => void>();
    (window as unknown as Record<string, unknown>)["__APIWEAVE_UPDATES__"] = {
      getStatus: () => Promise.resolve(initial),
      check: () => Promise.resolve(initial),
      download: () => Promise.resolve(initial),
      setPolicy: () => Promise.resolve(initial),
      restartAndInstall: () => Promise.resolve(),
      openReleasePage: () => Promise.resolve(),
      openLogFile: () => Promise.resolve(),
      onStatusChanged: (callback: (status: UpdateStatus) => void) => {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
    };
    return {
      push: (status: UpdateStatus) => {
        for (const listener of listeners) listener(status);
      },
    };
  }

  function renderNav() {
    renderNavAt("/personal/personal/workflows");
  }

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)[
      "__APIWEAVE_UPDATES__"
    ];
  });

  it("leaves the Settings label untouched when nothing is pending", async () => {
    installBridge(baseStatus);
    renderNav();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy(),
    );
  });

  it("marks Settings when a release is available for manual download", async () => {
    installBridge({ ...baseStatus, state: "available", latestVersion: "0.7.0" });
    renderNav();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Settings (update available)" }),
      ).toBeTruthy(),
    );
  });

  it("marks Settings when an update is downloaded and waiting on a restart", async () => {
    installBridge({
      ...baseStatus,
      state: "downloaded",
      latestVersion: "0.7.0",
      supportsAutoInstall: true,
    });
    renderNav();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Settings (update available)" }),
      ).toBeTruthy(),
    );
  });

  it("picks up the silent startup check pushed from main after mount", async () => {
    const bridge = installBridge(baseStatus);
    renderNav();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy(),
    );

    act(() => {
      bridge.push({ ...baseStatus, state: "available", latestVersion: "0.7.0" });
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Settings (update available)" }),
      ).toBeTruthy(),
    );
  });

  it("does not mark Settings while a background download is still running", async () => {
    installBridge({
      ...baseStatus,
      state: "downloading",
      latestVersion: "0.7.0",
      downloadProgressPercent: 40,
      supportsAutoInstall: true,
    });
    renderNav();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy(),
    );
  });
});
