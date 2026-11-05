import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpdateSettingsPanel } from "../UpdateSettingsPanel";
import type { UpdateStatusContextValue } from "../../../types";
import type { UpdateStatus } from "@shared/types/UpdateStatus";

const context = vi.hoisted(() => ({
  value: {} as UpdateStatusContextValue,
}));

// The panel's job is presenting `useUpdateStatus`; the provider's own IPC
// subscription is covered by UpdateStatusContext.test.tsx.
vi.mock("../../../contexts/UpdateStatusContext", () => ({
  useUpdateStatus: () => context.value,
}));

function status(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    state: "idle",
    currentVersion: "0.6.3",
    latestVersion: null,
    releaseUrl: null,
    downloadProgressPercent: null,
    supportsAutoInstall: true,
    policy: "notify",
    lastCheckedAt: null,
    error: null,
    ...overrides,
  };
}

function install(next: Partial<UpdateStatus> = {}) {
  const setPolicy = vi.fn(() => Promise.resolve());
  context.value = {
    status: status(next),
    checking: false,
    pending: false,
    checkNow: vi.fn(() => Promise.resolve()),
    download: vi.fn(() => Promise.resolve()),
    setPolicy,
    restartAndInstall: vi.fn(() => Promise.resolve()),
    openReleasePage: vi.fn(() => Promise.resolve()),
    openLogFile: vi.fn(() => Promise.resolve()),
    isAvailable: true,
  };
  return { setPolicy };
}

beforeEach(() => {
  install();
});

describe("UpdateSettingsPanel", () => {
  it("names the version an available update would install", () => {
    install({ state: "available", latestVersion: "0.7.0" });

    render(<UpdateSettingsPanel />);

    expect(screen.getByText("v0.7.0 is available.")).toBeInTheDocument();
  });

  it("hides Automatic where the app cannot install its own update", () => {
    install({ state: "available", supportsAutoInstall: false });

    render(<UpdateSettingsPanel />);

    expect(screen.getByText("Notify me")).toBeInTheDocument();
    expect(screen.queryByText("Automatic")).not.toBeInTheDocument();
    expect(
      screen.getByText(/installs updates from GitHub Releases by hand/),
    ).toBeInTheDocument();
  });

  it("offers a restart instead of a check once an update is staged", () => {
    install({ state: "downloaded", latestVersion: "0.7.0" });

    render(<UpdateSettingsPanel />);

    expect(
      screen.getByRole("button", { name: /Restart & install/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Check for updates/ }),
    ).not.toBeInTheDocument();
  });

  it("sends the chosen policy through", async () => {
    const { setPolicy } = install();

    render(<UpdateSettingsPanel />);
    await userEvent.click(screen.getByText("Manual only"));

    expect(setPolicy).toHaveBeenCalledWith("manual");
  });

  it("says where updates are unavailable", () => {
    install();
    context.value = { ...context.value, isAvailable: false };

    render(<UpdateSettingsPanel />);

    expect(
      screen.getByText("Update checks are only available in the desktop app."),
    ).toBeInTheDocument();
  });
});
