import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BootGate } from "./BootGate";

const setRuntime = (apiUrl?: string): void => {
  if (apiUrl === undefined) {
    delete window.__APIWEAVE_RUNTIME__;
  } else {
    window.__APIWEAVE_RUNTIME__ = { apiUrl };
  }
};

const setIpc = (enabled: boolean): void => {
  if (!enabled) {
    delete window.__APIWEAVE_IPC__;
    return;
  }
  window.__APIWEAVE_IPC__ = {
    invoke: vi.fn().mockResolvedValue({ ok: true, data: null }),
    onRunProgress: vi.fn().mockReturnValue(() => undefined),
  };
};

describe("BootGate", () => {
  beforeEach(() => {
    setRuntime(undefined);
    setIpc(false);
  });
  afterEach(() => {
    setRuntime(undefined);
    setIpc(false);
    vi.unstubAllGlobals();
  });

  it("renders children immediately when not in the desktop app", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <BootGate>
        <div>canvas</div>
      </BootGate>,
    );

    expect(screen.getByText("canvas")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders children when the desktop IPC bridge is available", () => {
    setRuntime("http://127.0.0.1:9999");
    setIpc(true);

    render(
      <BootGate>
        <div>canvas</div>
      </BootGate>,
    );

    expect(screen.getByText("canvas")).toBeInTheDocument();
  });

  it("does not poll HTTP health in desktop mode", async () => {
    setRuntime("http://127.0.0.1:9999");
    setIpc(true);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <BootGate>
        <div>canvas</div>
      </BootGate>,
    );

    expect(await screen.findByText("canvas")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
