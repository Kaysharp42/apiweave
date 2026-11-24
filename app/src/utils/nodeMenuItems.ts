import {
  BookmarkPlus,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Files,
  Play,
  Trash2,
} from "lucide-react";
import type { ContextMenuItem } from "../types/ContextMenuItem";
import type { NodeMenuItemsOptions } from "../types/NodeMenuItemsOptions";

/**
 * Append one group to the menu. The group's first row carries the divider,
 * unless it is the menu's first row — a separator above nothing reads as a
 * stray line rather than a group.
 */
function appendGroup(
  items: ContextMenuItem[],
  group: readonly ContextMenuItem[],
): void {
  const first = group[0];
  if (first === undefined) return;

  items.push(
    ...(items.length === 0
      ? [first, ...group.slice(1)]
      : [{ ...first, separated: true }, ...group.slice(1)]),
  );
}

/**
 * The one action list behind both node menu triggers — right-click on a node
 * and the node's ⋯ button. Rows are grouped: what the node can do to the run,
 * what it can do to itself, how it displays, and the destructive action last.
 */
export function buildNodeMenuItems(
  options: NodeMenuItemsOptions,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];

  appendGroup(items, [
    ...(options.runnable
      ? [
          {
            key: "run-from",
            icon: Play,
            label: "Run from here",
            onSelect: options.onRunFrom,
          },
        ]
      : []),
    ...options.stepActions,
  ]);

  appendGroup(items, [
    {
      key: "duplicate",
      icon: Files,
      label: "Duplicate",
      shortcut: options.shortcuts.duplicate,
      onSelect: options.onDuplicate,
    },
    {
      key: "copy",
      icon: Copy,
      label: "Copy",
      shortcut: options.shortcuts.copy,
      onSelect: options.onCopy,
    },
    ...(options.presetable
      ? [
          {
            key: "save-preset",
            icon: BookmarkPlus,
            label: "Save as preset",
            onSelect: options.onSavePreset,
          },
        ]
      : []),
  ]);

  if (options.collapsible) {
    appendGroup(items, [
      {
        key: "toggle-expand",
        icon: options.isExpanded ? ChevronsDownUp : ChevronsUpDown,
        label: options.isExpanded ? "Collapse" : "Expand",
        onSelect: options.onToggleExpand,
      },
    ]);
  }

  appendGroup(items, [
    {
      key: "delete",
      icon: Trash2,
      label: "Delete",
      destructive: true,
      shortcut: options.shortcuts.delete,
      onSelect: options.onDelete,
    },
  ]);

  return items;
}
