import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { UpdateStatusProvider, useUpdateStatus } from "./UpdateStatusContext";
import type { UpdateStatus } from "@shared/types/UpdateStatus";

const status: UpdateStatus = {
  state: "available",
  currentVersion: "0.6.3",
  latestVersion: "0.7.0",
  releaseUrl: "https://github.com/Kaysharp42/apiweave/releases/tag/v0.7.0",
  downloadProgressPercent: null,
  supportsAutoInstall: true,
  policy: "notify",
  lastCheckedAt: null,
  error: null,
};

function installBridge() {
  const listeners = new Set<(next: UpdateStatus) => void>();
  const getStatus = vi.fn(() => Promise.resolve(status));
  (window as unknown as Record<string, unknown>)["__APIWEAVE_UPDATES__"] = {
    getStatus,
    check: () => Promise.resolve(status),
    download: () => Promise.resolve(status),
    setPolicy: () => Promise.resolve(status),
    restartAndInstall: () => Promise.resolve(),
    openReleasePage: () => Promise.resolve(),
    openLogFile: () => Promise.resolve(),
    onStatusChanged: (callback: (next: UpdateStatus) => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
  return { getStatus, subscriberCount: () => listeners.size };
}

/** Stands in for AppNavBar / SettingsContent / UpdateSettingsModal / the banner. */
function Consumer({ label }: { readonly label: string }) {
  const { status: current, pending } = useUpdateStatus();
  return (
    <span data-testid={label}>
      {current?.latestVersion ?? "none"}:{String(pending)}
    </span>
  );
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>)["__APIWEAVE_UPDATES__"];
});

describe("UpdateStatusProvider", () => {
  it("holds one IPC subscription however many consumers read it", async () => {
    const bridge = installBridge();

    render(
      <UpdateStatusProvider>
        <Consumer label="nav" />
        <Consumer label="settings" />
        <Consumer label="modal" />
        <Consumer label="banner" />
      </UpdateStatusProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("nav").textContent).toBe("0.7.0:true");
    });

    // The regression this exists to catch: four components each calling a
    // standalone hook meant four listeners on a channel main broadcasts to, and
    // four copies of one piece of global state that could drift apart.
    expect(bridge.subscriberCount()).toBe(1);
    expect(bridge.getStatus).toHaveBeenCalledOnce();
  });

  it("gives every consumer the same status", async () => {
    installBridge();

    render(
      <UpdateStatusProvider>
        <Consumer label="nav" />
        <Consumer label="banner" />
      </UpdateStatusProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("nav").textContent).toBe("0.7.0:true");
    });
    expect(screen.getByTestId("banner").textContent).toBe("0.7.0:true");
  });

  it("releases the subscription on unmount", async () => {
    const bridge = installBridge();

    const view = render(
      <UpdateStatusProvider>
        <Consumer label="nav" />
      </UpdateStatusProvider>,
    );
    await waitFor(() => expect(bridge.subscriberCount()).toBe(1));

    view.unmount();

    expect(bridge.subscriberCount()).toBe(0);
  });

  it("refuses to work outside the provider", () => {
    installBridge();
    // Falling back to a private subscription here is what let the pattern get
    // copied to four call sites in the first place, so this has to be loud.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<Consumer label="orphan" />)).toThrow(
        /within an UpdateStatusProvider/,
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
