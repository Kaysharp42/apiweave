import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpdateReadyBanner } from "./UpdateReadyBanner";
import { UpdateStatusProvider } from "../../contexts/UpdateStatusContext";
import type { UpdateStatus } from "@shared/types/UpdateStatus";

const baseStatus: UpdateStatus = {
  state: "idle",
  currentVersion: "0.6.3",
  latestVersion: null,
  releaseUrl: null,
  downloadProgressPercent: null,
  supportsAutoInstall: true,
  policy: "notify",
  lastCheckedAt: null,
  error: null,
};

const downloaded: UpdateStatus = {
  ...baseStatus,
  state: "downloaded",
  latestVersion: "0.7.0",
  downloadProgressPercent: 100,
};

const restartAndInstall = vi.fn();

function installBridge(initial: UpdateStatus) {
  const listeners = new Set<(status: UpdateStatus) => void>();
  (window as unknown as Record<string, unknown>)["__APIWEAVE_UPDATES__"] = {
    getStatus: () => Promise.resolve(initial),
    check: () => Promise.resolve(initial),
    download: () => Promise.resolve(initial),
    setPolicy: () => Promise.resolve(initial),
    restartAndInstall: () => {
      restartAndInstall();
      return Promise.resolve();
    },
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

/** The banner reads status from the shared context, so every case needs the
 * provider that owns the one IPC subscription. */
function renderBanner() {
  return render(
    <UpdateStatusProvider>
      <UpdateReadyBanner />
    </UpdateStatusProvider>,
  );
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>)["__APIWEAVE_UPDATES__"];
  restartAndInstall.mockClear();
});

describe("UpdateReadyBanner", () => {
  it("stays out of the way until an update is staged", async () => {
    installBridge(baseStatus);
    renderBanner();

    // Let the mount-time getStatus resolve before asserting on absence.
    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
    });
  });

  it("does not interrupt while the download is still running", async () => {
    installBridge({
      ...baseStatus,
      state: "downloading",
      latestVersion: "0.7.0",
      downloadProgressPercent: 40,
    });
    renderBanner();

    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
    });
  });

  it("names the version waiting on a restart", async () => {
    installBridge(downloaded);
    renderBanner();

    expect(await screen.findByText(/v0\.7\.0 is ready/)).toBeTruthy();
  });

  it("appears when the download finishes mid-session", async () => {
    const bridge = installBridge(baseStatus);
    renderBanner();
    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
    });

    act(() => bridge.push(downloaded));

    expect(await screen.findByText(/v0\.7\.0 is ready/)).toBeTruthy();
  });

  it("installs on Restart now", async () => {
    installBridge(downloaded);
    renderBanner();

    await userEvent.click(await screen.findByRole("button", { name: /restart now/i }));

    expect(restartAndInstall).toHaveBeenCalledOnce();
  });

  it("dismisses for the session on Later", async () => {
    installBridge(downloaded);
    renderBanner();

    await userEvent.click(await screen.findByRole("button", { name: /dismiss/i }));

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("re-earns the interruption for a newer version", async () => {
    const bridge = installBridge(downloaded);
    renderBanner();
    await userEvent.click(await screen.findByRole("button", { name: /dismiss/i }));

    act(() => bridge.push({ ...downloaded, latestVersion: "0.8.0" }));

    expect(await screen.findByText(/v0\.8\.0 is ready/)).toBeTruthy();
  });
});
