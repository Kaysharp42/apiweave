import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import useKeyboardShortcuts from "./useKeyboardShortcuts";

function press(combo: { key: string; ctrlKey?: boolean; shiftKey?: boolean }) {
  const event = new KeyboardEvent("keydown", {
    key: combo.key,
    ctrlKey: !!combo.ctrlKey,
    shiftKey: !!combo.shiftKey,
    bubbles: true,
    cancelable: true,
  });
  const keyCode = combo.key.toUpperCase().charCodeAt(0);
  Object.defineProperty(event, "keyCode", { value: keyCode });
  Object.defineProperty(event, "which", { value: keyCode });
  document.dispatchEvent(event);
}

describe("useKeyboardShortcuts", () => {
  it("fires onNewWorkflow for ctrl+n", () => {
    const onNewWorkflow = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onNewWorkflow }));

    press({ key: "n", ctrlKey: true });

    expect(onNewWorkflow).toHaveBeenCalledTimes(1);
  });

  it("fires onCloseTab for ctrl+w", () => {
    const onCloseTab = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onCloseTab }));

    press({ key: "w", ctrlKey: true });

    expect(onCloseTab).toHaveBeenCalledTimes(1);
  });

  it("fires onNextTab / onPrevTab for ctrl+tab and ctrl+shift+tab", () => {
    const onNextTab = vi.fn();
    const onPrevTab = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onNextTab, onPrevTab }));

    const tabEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(tabEvent, "keyCode", { value: 9 });
    Object.defineProperty(tabEvent, "which", { value: 9 });
    document.dispatchEvent(tabEvent);
    expect(onNextTab).toHaveBeenCalledTimes(1);

    const shiftTabEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(shiftTabEvent, "keyCode", { value: 9 });
    Object.defineProperty(shiftTabEvent, "which", { value: 9 });
    document.dispatchEvent(shiftTabEvent);
    expect(onPrevTab).toHaveBeenCalledTimes(1);
  });

  it("does not fire shortcuts while typing in an input", () => {
    const onNewWorkflow = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onNewWorkflow }));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent("keydown", {
      key: "n",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "keyCode", {
      value: "n".toUpperCase().charCodeAt(0),
    });
    Object.defineProperty(event, "which", {
      value: "n".toUpperCase().charCodeAt(0),
    });
    input.dispatchEvent(event);

    expect(onNewWorkflow).not.toHaveBeenCalled();
    input.remove();
  });

  it("does not fire ctrl+n with another modifier held", () => {
    const onNewWorkflow = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onNewWorkflow }));

    press({ key: "N", ctrlKey: true, shiftKey: true });

    expect(onNewWorkflow).not.toHaveBeenCalled();
  });

  it("opens the shortcuts help for ? outside a field only", () => {
    const onShowShortcutsHelp = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onShowShortcutsHelp }));

    press({ key: "?", shiftKey: true });
    expect(onShowShortcutsHelp).toHaveBeenCalledTimes(1);

    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "?", shiftKey: true, bubbles: true }),
    );
    expect(onShowShortcutsHelp).toHaveBeenCalledTimes(1);
    textarea.remove();
  });

  it("stops listening once disabled", () => {
    const onCloseTab = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }) => useKeyboardShortcuts({ enabled, onCloseTab }),
      { initialProps: { enabled: true } },
    );

    rerender({ enabled: false });
    press({ key: "w", ctrlKey: true });

    expect(onCloseTab).not.toHaveBeenCalled();
  });
});
