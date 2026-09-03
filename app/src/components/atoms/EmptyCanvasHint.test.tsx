import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { EmptyCanvasHint } from "./EmptyCanvasHint";

describe("EmptyCanvasHint", () => {
  // The one property whose absence turns this hint into a bug report about a
  // dead canvas: the overlay spans the whole pane, so without it every
  // right-click and box-select on an empty workflow hits the hint instead.
  it("never takes pointer events", () => {
    const { container } = render(<EmptyCanvasHint />);
    expect(container.firstElementChild).toHaveClass("pointer-events-none");
  });
});
