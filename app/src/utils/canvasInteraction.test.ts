import { describe, it, expect } from "vitest";
import { canvasInteractionProps } from "./canvasInteraction";
import type { CanvasPrefs } from "../stores/CanvasPrefsStore";

const base: CanvasPrefs = {
  dragMode: "pan",
  locked: false,
  snapToGrid: false,
  gridSize: 24,
  wheelZoom: true,
};

describe("canvasInteractionProps", () => {
  // `panOnDrag` is the only expression in the feature with branches in it, so
  // it gets the table: every {dragMode, locked, spacePan} combination.
  it.each([
    { dragMode: "pan", locked: false, spacePan: false, panOnDrag: [0, 1], selectionOnDrag: false },
    { dragMode: "pan", locked: false, spacePan: true, panOnDrag: [0, 1], selectionOnDrag: false },
    { dragMode: "select", locked: false, spacePan: false, panOnDrag: [1], selectionOnDrag: true },
    // Space wins over select mode: left-drag pans while it is held.
    { dragMode: "select", locked: false, spacePan: true, panOnDrag: [0, 1], selectionOnDrag: false },
    { dragMode: "pan", locked: true, spacePan: false, panOnDrag: false, selectionOnDrag: false },
    // A locked canvas does not pan even for space — that is the point of it.
    { dragMode: "pan", locked: true, spacePan: true, panOnDrag: false, selectionOnDrag: false },
    { dragMode: "select", locked: true, spacePan: false, panOnDrag: false, selectionOnDrag: true },
    { dragMode: "select", locked: true, spacePan: true, panOnDrag: false, selectionOnDrag: false },
  ] as const)(
    "dragMode=$dragMode locked=$locked spacePan=$spacePan",
    ({ dragMode, locked, spacePan, panOnDrag, selectionOnDrag }) => {
      const props = canvasInteractionProps({ ...base, dragMode, locked }, spacePan);
      expect(props.panOnDrag).toEqual(panOnDrag);
      expect(props.selectionOnDrag).toBe(selectionOnDrag);
    },
  );

  it("wheel either zooms or pans, never both", () => {
    const zoom = canvasInteractionProps({ ...base, wheelZoom: true }, false);
    expect([zoom.zoomOnScroll, zoom.panOnScroll]).toEqual([true, false]);

    const pan = canvasInteractionProps({ ...base, wheelZoom: false }, false);
    expect([pan.zoomOnScroll, pan.panOnScroll]).toEqual([false, true]);
  });

  it("freezes the wheel and the pinch when locked", () => {
    const props = canvasInteractionProps({ ...base, locked: true }, false);
    expect(props.zoomOnScroll).toBe(false);
    expect(props.panOnScroll).toBe(false);
    expect(props.zoomOnPinch).toBe(false);
  });

  it("carries the grid size through as a square grid", () => {
    const props = canvasInteractionProps(
      { ...base, snapToGrid: true, gridSize: 16 },
      false,
    );
    expect(props.snapToGrid).toBe(true);
    expect(props.snapGrid).toEqual([16, 16]);
  });
});
