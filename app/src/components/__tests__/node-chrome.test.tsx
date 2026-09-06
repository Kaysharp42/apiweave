import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { BaseNode } from "../atoms/flow/BaseNode";

/**
 * The node chrome invariants — the ones a screenshot cannot assert.
 *
 * All three come out of the same reading: a node should say what kind it is
 * and what state it is in, each exactly once, and never move a pixel while
 * doing it.
 */
describe("node chrome", () => {
  const mount = (ui: ReactElement) =>
    render(<ReactFlowProvider>{ui}</ReactFlowProvider>);

  const slab = () => screen.getByLabelText(/^Node status:/);

  it("draws the kind on a 3px cap in the kind's own hue", () => {
    mount(
      <BaseNode
        title="Login"
        tileHue="var(--aw-method-post)"
        handleRight={{ type: "source" }}
      />,
    );

    expect(slab().className).toContain("border-t-[3px]");
    expect(slab().style.borderTopColor).toBe("var(--aw-method-post)");
  });

  it("leaves the border alone on selection", () => {
    // Selection is a ring and nothing else. A node that also swapped its
    // border colour would twitch by a pixel every time it was clicked, and
    // would overwrite whatever its state was reporting.
    mount(<BaseNode title="Login" tileHue="var(--aw-method-get)" />);
    const unselected = slab().className;
    const unselectedCap = slab().style.borderTopColor;

    mount(<BaseNode title="Login" tileHue="var(--aw-method-get)" selected />);
    const [, selected] = screen.getAllByLabelText(/^Node status:/);

    expect(selected?.className).toBe(unselected);
    expect(selected?.style.borderTopColor).toBe(unselectedCap);
  });

  it("reports whether a socket has an edge, so only connected ones can hide", () => {
    // The gotcha this pins down: hiding every socket at rest leaves a
    // first-time user nothing to say a node can be connected at all. An
    // unconnected socket stays visible, and `data-connected` is what the
    // stylesheet keys that off.
    const { container } = mount(
      <BaseNode
        title="Login"
        tileHue="var(--aw-method-post)"
        handleRight={{ type: "source" }}
      />,
    );

    const handle = container.querySelector(".aw-node-handle");
    expect(handle?.getAttribute("data-connected")).toBe("false");
  });
});
