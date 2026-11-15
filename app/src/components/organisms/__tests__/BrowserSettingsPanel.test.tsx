import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserSettingsPanel } from "../BrowserSettingsPanel";
import { browser } from "../../../utils/apiweaveClient";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("../../../utils/apiweaveClient", () => ({
  browser: { getSettings: vi.fn(), setSettings: vi.fn(), listInstalled: vi.fn() },
}));

describe("BrowserSettingsPanel", () => {
  beforeEach(() => {
    vi.mocked(browser.getSettings).mockResolvedValue({ showBrowser: false });
    vi.mocked(browser.setSettings).mockImplementation(async (settings) => settings);
    vi.mocked(browser.listInstalled).mockResolvedValue(["msedge"]);
  });

  it("names the browser Automatic picks and marks the ones that did not start", async () => {
    render(<BrowserSettingsPanel />);

    expect(await screen.findByRole("option", { name: "Automatic (Microsoft Edge)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Google Chrome (not found)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Microsoft Edge" })).toBeInTheDocument();
  });

  it("saves a chosen browser and the window toggle as soon as they change", async () => {
    const user = userEvent.setup();
    render(<BrowserSettingsPanel />);

    await user.selectOptions(await screen.findByRole("combobox"), "msedge");
    expect(browser.setSettings).toHaveBeenLastCalledWith({ showBrowser: false, channel: "msedge" });

    await user.click(screen.getByLabelText("Show the browser during runs"));
    expect(browser.setSettings).toHaveBeenLastCalledWith({ showBrowser: true, channel: "msedge" });

    await user.selectOptions(screen.getByRole("combobox"), "");
    expect(browser.setSettings).toHaveBeenLastCalledWith({ showBrowser: true });
  });

  it("warns when the chosen browser did not start here", async () => {
    vi.mocked(browser.getSettings).mockResolvedValue({ showBrowser: false, channel: "chrome" });
    render(<BrowserSettingsPanel />);

    expect(await screen.findByRole("alert")).toHaveTextContent("did not start on this machine");
  });
});
