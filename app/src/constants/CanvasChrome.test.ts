import { describe, expect, it } from "vitest";
import {
  CanvasCornerGutter,
  MiniMapSize,
  canvasActionsBottom,
} from "./CanvasChrome";

describe("canvasActionsBottom", () => {
  it("sits above the minimap when the map is showing", () => {
    expect(canvasActionsBottom(true)).toBe(
      CanvasCornerGutter * 2 + MiniMapSize.height,
    );
  });

  it("drops to the canvas floor when the minimap is hidden", () => {
    expect(canvasActionsBottom(false)).toBe(CanvasCornerGutter);
  });
});
