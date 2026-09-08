import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpdateBanner } from "./UpdateBanner";
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
const downloadSpy = vi.fn();
const openReleasePage = vi.fn();

function installBridge(initial: UpdateStatus) {
  const listeners = new Set<(status: UpdateStatus) => void>();
  (window as unknown as Record<string, unknown>)["__APIWEAVE_UPDATES__"] = {
    getStatus: () => Promise.resolve(initial),
    check: () => Promise.resolve(initial),
    download: () => {
      downloadSpy();
      return Promise.resolve(initial);
    },
    setPolicy: () => Promise.resolve(initial),
    restartAndInstall: () => {
      restartAndInstall();
      return Promise.resolve();
    },
    openReleasePage: () => {
      openReleasePage();
      return Promise.resolve();
    },
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
      <UpdateBanner />
    </UpdateStatusProvider>,
  );
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>)["__APIWEAVE_UPDATES__"];
  restartAndInstall.mockClear();
  downloadSpy.mockClear();
  openReleasePage.mockClear();
});

const available: UpdateStatus = {
  ...baseStatus,
  state: "available",
  latestVersion: "0.7.0",
  releaseUrl: "https://example.test/releases/0.7.0",
};

describe("UpdateBanner", () => {
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

  it("announces a release the user still has to ask for", async () => {
    installBridge(available);
    renderBanner();

    expect(await screen.findByText(/v0\.7\.0 is available/)).toBeTruthy();
    await userEvent.click(
      await screen.findByRole("button", { name: /download update/i }),
    );
    expect(downloadSpy).toHaveBeenCalledOnce();
  });

  it("sends platforms that can't self-install to the release page", async () => {
    installBridge({ ...available, supportsAutoInstall: false });
    renderBanner();

    await userEvent.click(
      await screen.findByRole("button", { name: /view release/i }),
    );
    expect(openReleasePage).toHaveBeenCalledOnce();
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it("keeps showing progress for the download it started", async () => {
    const bridge = installBridge(available);
    renderBanner();
    await userEvent.click(
      await screen.findByRole("button", { name: /download update/i }),
    );

    act(() =>
      bridge.push({
        ...available,
        state: "downloading",
        downloadProgressPercent: 42,
      }),
    );

    expect(await screen.findByText(/42%/)).toBeTruthy();
  });

  it("still announces the restart after dismissing the same version's download notice", async () => {
    const bridge = installBridge(available);
    renderBanner();
    await userEvent.click(await screen.findByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("status")).toBeNull();

    act(() => bridge.push(downloaded));

    expect(await screen.findByText(/v0\.7\.0 is ready/)).toBeTruthy();
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
