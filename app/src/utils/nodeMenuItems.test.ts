import { describe, expect, it, vi } from "vitest";
import {
  BookmarkPlus,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Files,
  Play,
  Trash2,
} from "lucide-react";
import { buildNodeMenuItems } from "./nodeMenuItems";
import type { ContextMenuItem } from "../types/ContextMenuItem";
import type { NodeMenuItemsOptions } from "../types/NodeMenuItemsOptions";

const shortcuts = { duplicate: "Ctrl+D", copy: "Ctrl+C", delete: "Delete" };

function stepAction(key: string): ContextMenuItem {
  return { key, icon: Play, label: key, onSelect: () => {} };
}

function options(
  overrides: Partial<NodeMenuItemsOptions> = {},
): NodeMenuItemsOptions {
  return {
    runnable: true,
    presetable: true,
    collapsible: true,
    isExpanded: false,
    stepActions: [],
    shortcuts,
    onRunFrom: () => {},
    onDuplicate: () => {},
    onCopy: () => {},
    onSavePreset: () => {},
    onToggleExpand: () => {},
    onDelete: () => {},
    ...overrides,
  };
}

describe("buildNodeMenuItems", () => {
  it("builds every group in product order, one divider per group", () => {
    const items = buildNodeMenuItems(
      options({ stepActions: [stepAction("repick-element")] }),
    );

    expect(items.map((item) => item.key)).toEqual([
      "run-from",
      "repick-element",
      "duplicate",
      "copy",
      "save-preset",
      "toggle-expand",
      "delete",
    ]);
    expect(items.map((item) => item.separated ?? false)).toEqual([
      false,
      false,
      true,
      false,
      false,
      true,
      true,
    ]);
    expect(items[0]?.icon).toBe(Play);
    expect(items[2]?.icon).toBe(Files);
    expect(items[3]?.icon).toBe(Copy);
    expect(items[4]?.icon).toBe(BookmarkPlus);
    expect(items[5]?.icon).toBe(ChevronsUpDown);
    expect(items[6]?.icon).toBe(Trash2);
    expect(items[2]?.shortcut).toBe("Ctrl+D");
    expect(items[3]?.shortcut).toBe("Ctrl+C");
    expect(items[6]?.shortcut).toBe("Delete");
    expect(items[6]?.destructive).toBe(true);
  });

  it("omits the groups whose actions do not apply", () => {
    const items = buildNodeMenuItems(
      options({
        runnable: false,
        presetable: false,
        collapsible: false,
        stepActions: [],
      }),
    );

    expect(items.map((item) => item.key)).toEqual([
      "duplicate",
      "copy",
      "delete",
    ]);
  });

  it("never separates the first row when there is nothing above it", () => {
    const items = buildNodeMenuItems(
      options({ runnable: false, stepActions: [] }),
    );

    expect(items[0]?.key).toBe("duplicate");
    expect(items[0]?.separated).toBeUndefined();
  });

  it("makes the first step action the first row when nothing precedes it", () => {
    const items = buildNodeMenuItems(
      options({ runnable: false, stepActions: [stepAction("repick-element")] }),
    );

    expect(items[0]?.key).toBe("repick-element");
    expect(items[0]?.separated).toBeUndefined();
  });

  it("labels the toggle for the state it will produce", () => {
    const collapsed = buildNodeMenuItems(options({ isExpanded: false })).find(
      (item) => item.key === "toggle-expand",
    );
    const expanded = buildNodeMenuItems(options({ isExpanded: true })).find(
      (item) => item.key === "toggle-expand",
    );

    expect(collapsed?.label).toBe("Expand");
    expect(collapsed?.icon).toBe(ChevronsUpDown);
    expect(expanded?.label).toBe("Collapse");
    expect(expanded?.icon).toBe(ChevronsDownUp);
  });

  it("wires each row to the callback it names", () => {
    const callbacks = {
      onRunFrom: vi.fn(),
      onDuplicate: vi.fn(),
      onCopy: vi.fn(),
      onSavePreset: vi.fn(),
      onToggleExpand: vi.fn(),
      onDelete: vi.fn(),
    };
    const stepSelect = vi.fn();
    const items = buildNodeMenuItems(
      options({
        ...callbacks,
        stepActions: [
          { key: "repick-element", icon: Play, label: "Re-pick", onSelect: stepSelect },
        ],
      }),
    );

    for (const item of items) item.onSelect();

    expect(stepSelect).toHaveBeenCalledOnce();
    expect(callbacks.onRunFrom).toHaveBeenCalledOnce();
    expect(callbacks.onDuplicate).toHaveBeenCalledOnce();
    expect(callbacks.onCopy).toHaveBeenCalledOnce();
    expect(callbacks.onSavePreset).toHaveBeenCalledOnce();
    expect(callbacks.onToggleExpand).toHaveBeenCalledOnce();
    expect(callbacks.onDelete).toHaveBeenCalledOnce();
  });
});
