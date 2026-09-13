import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScrollableNodeTextArea } from "./ScrollableNodeTextArea";

describe("ScrollableNodeTextArea", () => {
  it("is not a scroll container until it is focused", () => {
    const { container } = render(
      <ScrollableNodeTextArea
        aria-label="Request body"
        value={'{"id": 1}'}
        readOnly
      />,
    );

    const wrapper = container.querySelector("[data-scrollable-node-textarea]");
    const textArea = screen.getByLabelText("Request body");

    // The whole point: no scroll container at rest, so Chromium never promotes
    // the box to its own layer and the glyphs stay sharp when the canvas is
    // zoomed out. Scrolling comes back on focus-within.
    expect(wrapper).toHaveClass("overflow-clip", "focus-within:overflow-auto");
    expect(wrapper).not.toHaveClass("overflow-auto");
    expect(wrapper).toHaveClass("resize-y");
    expect(textArea).toHaveClass("resize-none", "overflow-hidden");
    expect(textArea).toHaveValue('{"id": 1}');
  });
});
