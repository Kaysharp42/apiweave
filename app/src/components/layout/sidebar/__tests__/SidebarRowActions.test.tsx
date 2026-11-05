import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SidebarRowActions } from "../SidebarRowActions";

describe("SidebarRowActions", () => {
  it("never captures pointer events, including through its gradient padding", () => {
    const { container } = render(
      <SidebarRowActions>actions</SidebarRowActions>,
    );

    const overlay = container.firstElementChild as HTMLElement;
    expect(overlay).toHaveClass("pointer-events-none");

    const buttons = overlay.firstElementChild as HTMLElement;
    expect(buttons).toHaveClass("pointer-events-none");
  });

  it("becomes interactive only when the row is hovered or focused", () => {
    const { container } = render(
      <SidebarRowActions>actions</SidebarRowActions>,
    );

    const overlay = container.firstElementChild as HTMLElement;
    const buttons = overlay.firstElementChild as HTMLElement;

    expect(overlay).toHaveClass("group-hover:opacity-100");
    expect(overlay).toHaveClass("group-focus-within:opacity-100");
    expect(buttons).toHaveClass("group-hover:pointer-events-auto");
    expect(buttons).toHaveClass("group-focus-within:pointer-events-auto");
  });

  it("blends its fade with the tint of a selected row", () => {
    const { container } = render(
      <SidebarRowActions active>actions</SidebarRowActions>,
    );

    const overlay = container.firstElementChild as HTMLElement;
    const tint = overlay.querySelector('[aria-hidden="true"]') as HTMLElement;

    // The opaque surface fade is the row's own background, and the tint laid
    // over it is the row's `bg-primary/10`, so the two meet at the same colour.
    expect(overlay).toHaveClass("from-surface-raised");
    expect(tint).toHaveClass("from-primary/10");
    expect(tint).toHaveClass("dark:from-primary-light/10");
  });
});
