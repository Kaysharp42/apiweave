import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import BrowserNode from "./BrowserNode";
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
});
