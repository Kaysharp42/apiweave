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

describe("BootGate", () => {
  beforeEach(() => setRuntime(undefined));
  afterEach(() => {
    setRuntime(undefined);
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

  it("shows the boot screen while the desktop backend is still starting", () => {
    setRuntime("http://127.0.0.1:9999");
    // never resolves → stays in booting phase
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );

    render(
      <BootGate>
        <div>canvas</div>
      </BootGate>,
    );

    expect(screen.getByText("Starting APIWeave…")).toBeInTheDocument();
    expect(screen.queryByText("canvas")).not.toBeInTheDocument();
  });

  it("reveals the app once the backend reports healthy", async () => {
    setRuntime("http://127.0.0.1:9999");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    render(
      <BootGate>
        <div>canvas</div>
      </BootGate>,
    );

    expect(await screen.findByText("canvas")).toBeInTheDocument();
  });
});
