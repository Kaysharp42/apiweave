import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NetworkSettingsPanel } from "../NetworkSettingsPanel";
import { network } from "../../../utils/apiweaveClient";
import type { NetworkSettingsState } from "@shared/types/NetworkSettingsState";

vi.mock("../../../utils/apiweaveClient", () => ({
  network: { get: vi.fn(), save: vi.fn(), chooseFile: vi.fn() },
}));

const stored: NetworkSettingsState = {
  settings: {
    proxyUrl: "http://proxy.corp:3128",
    proxyBypass: "localhost",
    proxyUsername: "alice",
    useSystemCa: true,
    caCertificateFiles: [],
    clientCertificates: [],
  },
  proxyPasswordSet: true,
  passphraseSet: [],
  problem: null,
};

describe("NetworkSettingsPanel", () => {
  beforeEach(() => {
    vi.mocked(network.get).mockResolvedValue(stored);
    vi.mocked(network.save).mockImplementation(async (update) => ({
      ...stored,
      settings: update.settings,
    }));
    vi.mocked(network.chooseFile).mockResolvedValue("/etc/corp-ca.pem");
  });

  it("keeps a stored password unless one is typed, and adds a CA chosen in the native picker", async () => {
    const user = userEvent.setup();
    render(<NetworkSettingsPanel />);

    expect(
      await screen.findByPlaceholderText("Saved — type to replace"),
    ).toHaveValue("");
    await user.click(
      screen.getByRole("button", { name: /Add CA certificate/ }),
    );
    expect(await screen.findByText("/etc/corp-ca.pem")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(network.save).toHaveBeenCalledWith({
      settings: { ...stored.settings, caCertificateFiles: ["/etc/corp-ca.pem"] },
      passphrases: {},
    });
  });

  it("sends a typed password and shows why a save was refused", async () => {
    vi.mocked(network.save).mockRejectedValueOnce(
      new Error("CA certificate /x.pem: cannot read /x.pem (ENOENT)"),
    );
    const user = userEvent.setup();
    render(<NetworkSettingsPanel />);

    await user.type(
      await screen.findByPlaceholderText("Saved — type to replace"),
      "hunter2",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(network.save).toHaveBeenCalledWith(
      expect.objectContaining({ proxyPassword: "hunter2" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "cannot read /x.pem",
    );
  });
});
