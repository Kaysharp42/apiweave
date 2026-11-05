import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { Toast } from "./Toast";

const captured = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));

vi.mock("sonner", () => ({
  Toaster: (props: Record<string, unknown>) => {
    captured.props = props;
    return null;
  },
}));

describe("Toast", () => {
  it("stacks bottom-right, clear of the status bar and the canvas action stack", () => {
    render(<Toast />);

    expect(captured.props?.position).toBe("bottom-right");
    expect(captured.props?.offset).toEqual({ bottom: 40, right: 56 });
  });
});
