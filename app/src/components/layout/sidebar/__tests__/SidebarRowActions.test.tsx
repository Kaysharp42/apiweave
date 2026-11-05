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

    expect(container.firstElementChild).toHaveClass(
      "from-[color-mix(in_oklab,var(--aw-primary)_10%,var(--aw-surface-raised))]",
    );
  });
});
