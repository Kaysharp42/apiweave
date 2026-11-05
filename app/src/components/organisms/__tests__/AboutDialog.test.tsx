import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AppInfo } from "@shared/types/AppInfo";
import { AboutDialog } from "../AboutDialog";
import useAboutStore from "../../../stores/AboutStore";
import { diagnosticsText } from "../../../utils/aboutInfo";

const appBridge = vi.hoisted(() => ({
  info: vi.fn(),
  revealDataFolder: vi.fn(),
}));

vi.mock("../../../utils/apiweaveClient", () => ({
  apiweave: { app: appBridge },
}));

const INFO: AppInfo = {
  version: "1.0.0",
  electron: "44.10.1",
  chromium: "142.0.0.0",
  node: "22.12.0",
  platform: "win32",
  arch: "x64",
  osVersion: "10.0.22631",
  dataFolder: "C:\\Users\\test\\AppData\\Roaming\\APIWeave",
};

beforeEach(() => {
  appBridge.info.mockReset().mockResolvedValue(INFO);
  appBridge.revealDataFolder.mockReset().mockResolvedValue(null);
  useAboutStore.setState({ isOpen: true });
});

describe("AboutDialog", () => {
  it("reports the versions and platform main returned", async () => {
    render(<AboutDialog />);

    expect(await screen.findByText("44.10.1")).toBeInTheDocument();
    expect(screen.getByText("142.0.0.0")).toBeInTheDocument();
    expect(screen.getByText("22.12.0")).toBeInTheDocument();
    expect(screen.getByText("Windows (x64) · 10.0.22631")).toBeInTheDocument();
    expect(screen.getByText("MIT")).toBeInTheDocument();
    expect(screen.getByText(/v1\.0\.0/)).toBeInTheDocument();
    expect(screen.getByText(INFO.dataFolder)).toBeInTheDocument();
  });

  it("links the repository, the docs and credits React Flow", async () => {
    render(<AboutDialog />);

    const github = await screen.findByRole("link", {
      name: "GitHub repository",
    });
    expect(github).toHaveAttribute(
      "href",
      "https://github.com/Kaysharp42/apiweave",
    );
    expect(screen.getByRole("link", { name: "Documentation" })).toHaveAttribute(
      "href",
      "https://github.com/Kaysharp42/apiweave/tree/main/docs",
    );
    expect(
      screen.getByText(/React Flow is © its contributors/),
    ).toBeInTheDocument();
  });

  it("copies a diagnostics block with no secret material", async () => {
    const user = userEvent.setup();
    render(<AboutDialog />);
    await screen.findByText(INFO.dataFolder);

    await user.click(
      screen.getByRole("button", { name: "Copy diagnostics" }),
    );

    await waitFor(async () => {
      expect(await navigator.clipboard.readText()).toBe(diagnosticsText(INFO));
    });
    expect(await navigator.clipboard.readText()).not.toMatch(
      /token|secret|password/i,
    );
    expect(
      screen.getByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
  });

  it("copies the data folder path and reveals it in the file manager", async () => {
    const user = userEvent.setup();
    render(<AboutDialog />);
    await screen.findByText(INFO.dataFolder);

    await user.click(
      screen.getByRole("button", { name: "Copy data folder path" }),
    );
    await waitFor(async () => {
      expect(await navigator.clipboard.readText()).toBe(INFO.dataFolder);
    });

    await user.click(screen.getByRole("button", { name: "Reveal" }));
    expect(appBridge.revealDataFolder).toHaveBeenCalledOnce();
  });

  it("explains a failed read instead of showing empty rows", async () => {
    appBridge.info.mockRejectedValue(new Error("no bridge"));
    render(<AboutDialog />);

    expect(await screen.findByRole("alert")).toHaveTextContent("no bridge");
  });
});
