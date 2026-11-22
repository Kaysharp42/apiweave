import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import BrowserNode from "./BrowserNode";
import useSidebarStore from "../../stores/SidebarStore";
import { apiweave } from "../../utils/apiweaveClient";
import type { BrowserNodeProps } from "../../types";

function mount(data: BrowserNodeProps["data"]) {
  return render(
    <ReactFlowProvider>
      <BrowserNode id="browser_1" data={data} />
    </ReactFlowProvider>,
  );
}

describe("BrowserNode", () => {
  it("says what a click acts on, in Playwright's own words", () => {
    mount({
      config: {
        action: "click",
        locator: { kind: "role", role: "button", name: "Save" },
      },
    });

    expect(screen.getByText("click")).toBeTruthy();
    expect(screen.getByText("getByRole('button', { name: 'Save' })")).toBeTruthy();
  });

  it("never prints the text a fill types", () => {
    mount({
      config: {
        action: "fill",
        locator: { kind: "label", value: "Password" },
        value: "hunter2",
      },
    });

    expect(screen.getByText("type into")).toBeTruthy();
    expect(screen.getByText("getByLabel('Password')")).toBeTruthy();
    expect(screen.queryByText(/hunter2/)).toBeNull();
  });

  describe("expanded", () => {
    beforeEach(() => {
      useSidebarStore.setState({ activeWorkspaceId: "workspace-1" });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("says what the step does, and that a run shows the page, before it has run", () => {
      mount({ config: { action: "click", locator: { kind: "text", value: "Save" } } });
      fireEvent.click(screen.getByTitle("Expand"));

      expect(screen.getByText("click")).toBeTruthy();
      expect(screen.getByText(/Run the workflow to see the page/)).toBeTruthy();
    });

    it("shows the page the last run left: its screenshot, address, and what a check found", async () => {
      const getArtifact = vi
        .spyOn(apiweave.runs, "getArtifact")
        .mockResolvedValue({ mime: "image/jpeg", base64: "AAAA" } as Awaited<
          ReturnType<typeof apiweave.runs.getArtifact>
        >);
      mount({
        config: { action: "expect-text", locator: { kind: "role", role: "heading" }, value: "Dashboard" },
        executionStatus: "error",
        executionResult: {
          duration: 1200,
          error: "Browser step: the text of getByRole('heading') did not contain the expected text within 10s",
          browser: {
            action: "expect-text",
            url: "https://shop.test/home",
            title: "Home",
            expected: "Dashboard",
            actual: "Welcome",
            screenshotArtifactId: "artifact-1",
          },
        },
      });
      fireEvent.click(screen.getByTitle("Expand"));

      expect(screen.getByRole("alert").textContent).toMatch(/did not contain the expected text/);
      expect(screen.getByText("https://shop.test/home")).toBeTruthy();
      expect(screen.getByText("Dashboard")).toBeTruthy();
      expect(screen.getByText("Welcome")).toBeTruthy();
      const image = await screen.findByAltText(/The page after the step ran/);
      expect(image.getAttribute("src")).toBe("data:image/jpeg;base64,AAAA");
      expect(getArtifact).toHaveBeenCalledWith("workspace-1", "artifact-1");
    });

    it("says why there is no screenshot when the run could not keep one", () => {
      const getArtifact = vi.spyOn(apiweave.runs, "getArtifact");
      mount({
        config: { action: "click", locator: { kind: "text", value: "Save" } },
        executionStatus: "success",
        executionResult: {
          browser: { action: "click", evidenceNote: "The screenshot was larger than 1 MB and was not kept." },
        },
      });
      fireEvent.click(screen.getByTitle("Expand"));

      expect(screen.getByText(/larger than 1 MB/)).toBeTruthy();
      expect(screen.queryByAltText(/The page after the step ran/)).toBeNull();
      expect(getArtifact).not.toHaveBeenCalled();
    });
  });
});
