import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserScreenshot } from "./BrowserScreenshot";
import { Modal } from "./Modal";
import { apiweave } from "../../utils/apiweaveClient";

type Artifact = Awaited<ReturnType<typeof apiweave.runs.getArtifact>>;

function stubArtifact() {
  return vi.spyOn(apiweave.runs, "getArtifact").mockResolvedValue({ mime: "image/jpeg", base64: "AAAA" } as Artifact);
}

describe("BrowserScreenshot", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is a plain image unless it is expandable", async () => {
    stubArtifact();
    render(<BrowserScreenshot workspaceId="workspace-1" artifactId="artifact-1" />);

    await screen.findByAltText(/The page after the step ran/);
    expect(screen.queryByRole("button", { name: /full size/ })).toBeNull();
  });

  it("opens full size in a dialog, from the image it already loaded", async () => {
    const getArtifact = stubArtifact();
    render(<BrowserScreenshot workspaceId="workspace-1" artifactId="artifact-1" expandable />);

    fireEvent.click(await screen.findByRole("button", { name: "View the screenshot full size" }));

    const dialog = await screen.findByRole("dialog");
    const full = dialog.querySelector("img");
    expect(full?.getAttribute("src")).toBe("data:image/jpeg;base64,AAAA");
    expect(getArtifact).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and leaves the node editor's dialog open", async () => {
    stubArtifact();
    const closeEditor = vi.fn();
    render(
      <Modal isOpen onClose={closeEditor} title="Click">
        <BrowserScreenshot workspaceId="workspace-1" artifactId="artifact-1" expandable />
      </Modal>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "View the screenshot full size" }));
    await screen.findByRole("dialog", { name: "Screenshot" });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Screenshot" })).toBeNull());
    expect(screen.getByRole("dialog", { name: "Click" })).toBeTruthy();
    expect(closeEditor).not.toHaveBeenCalled();
  });

  it("keeps arrow keys from stepping the node editor while it is open", async () => {
    stubArtifact();
    const stepped = vi.fn();
    const onWindowKey = (event: KeyboardEvent) => {
      if (!event.defaultPrevented) stepped(event.key);
    };
    window.addEventListener("keydown", onWindowKey);
    render(<BrowserScreenshot workspaceId="workspace-1" artifactId="artifact-1" expandable />);

    fireEvent.click(await screen.findByRole("button", { name: "View the screenshot full size" }));
    const full = (await screen.findByRole("dialog")).querySelector("img");
    fireEvent.keyDown(full as HTMLImageElement, { key: "ArrowRight" });
    window.removeEventListener("keydown", onWindowKey);

    expect(stepped).not.toHaveBeenCalled();
  });
});
