import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCanvasKeyboardShortcuts } from "./useCanvasKeyboardShortcuts";

function setup(overrides: Record<string, unknown> = {}) {
  const handlers = {
    isEditorOverlayOpen: false,
    isRunning: false,
    onSave: vi.fn(),
    onRun: vi.fn(),
    onToggleJsonEditor: vi.fn(),
    onFocusDirection: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onGroup: vi.fn(),
    onUngroup: vi.fn(),
    onOpenCommandPalette: vi.fn(),
    ...overrides,
  };
  renderHook(() => useCanvasKeyboardShortcuts(handlers));
  return handlers;
}

function press(
  key: string,
  init: KeyboardEventInit = {},
  target: EventTarget = window,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    cancelable: true,
    bubbles: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe("useCanvasKeyboardShortcuts", () => {
  it("maps the undo chord and its two redo spellings", () => {
    const h = setup();

    expect(press("z", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(h.onUndo).toHaveBeenCalledTimes(1);
    expect(h.onRedo).not.toHaveBeenCalled();

    press("Z", { ctrlKey: true, shiftKey: true });
    press("y", { ctrlKey: true });
    expect(h.onRedo).toHaveBeenCalledTimes(2);
    expect(h.onUndo).toHaveBeenCalledTimes(1);
  });

  // Ctrl+Shift+Z shares the branch that owns directional focus; taking one
  // must not eat the other.
  it("maps the frame chords", () => {
    const h = setup();

    press("g", { ctrlKey: true });
    press("G", { ctrlKey: true, shiftKey: true });

    expect(h.onGroup).toHaveBeenCalledTimes(1);
    expect(h.onUngroup).toHaveBeenCalledTimes(1);
  });

  it("keeps directional focus on Ctrl+Shift+arrow", () => {
    const h = setup();

    press("ArrowUp", { ctrlKey: true, shiftKey: true });

    expect(h.onFocusDirection).toHaveBeenCalledWith("up");
    expect(h.onRedo).not.toHaveBeenCalled();
  });

  it("still owns save, run and the JSON editor", () => {
    const h = setup();

    press("s", { ctrlKey: true });
    press("j", { ctrlKey: true });
    press("F5");

    expect(h.onSave).toHaveBeenCalledTimes(1);
    expect(h.onToggleJsonEditor).toHaveBeenCalledTimes(1);
    expect(h.onRun).toHaveBeenCalledTimes(1);
  });

  it("opens the command palette with Ctrl+K", () => {
    const h = setup();

    expect(press("k", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(h.onOpenCommandPalette).toHaveBeenCalledTimes(1);
  });

  it("does not run while a run is in flight or an overlay owns the keyboard", () => {
    const running = setup({ isRunning: true });
    press("F5");
    press("r", { ctrlKey: true });
    expect(running.onRun).not.toHaveBeenCalled();

    const overlaid = setup({ isEditorOverlayOpen: true });
    press("z", { ctrlKey: true });
    expect(overlaid.onUndo).not.toHaveBeenCalled();
  });

  it("leaves an editable target to the browser's own undo", () => {
    const h = setup();
    const input = document.createElement("input");
    document.body.append(input);

    press("z", { ctrlKey: true }, input);

    expect(h.onUndo).not.toHaveBeenCalled();
    input.remove();
  });

  it("ignores an unmodified keystroke", () => {
    const h = setup();

    expect(press("z").defaultPrevented).toBe(false);
    expect(h.onUndo).not.toHaveBeenCalled();
  });
});
