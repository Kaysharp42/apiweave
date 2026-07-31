import type { NodeActionMenuItem } from "../types";

export const buildNodeActionMenuItems = ({
  collapsible = false,
  isExpanded = false,
  presetable = false,
} = {}): NodeActionMenuItem[] => {
  const items: NodeActionMenuItem[] = [
    { key: "duplicate", label: "Duplicate" },
    { key: "copy", label: "Copy" },
  ];

  // Only the configurable node types can become a preset — a start/end node
  // has no config worth naming and reusing.
  if (presetable) {
    items.push({ key: "save-preset", label: "Save as preset" });
  }

  if (collapsible) {
    items.push({
      key: "toggle-expand",
      label: isExpanded ? "Collapse" : "Expand",
    });
  }

  return items;
};

export const getNextNodeExpandedState = (currentState: boolean): boolean =>
  !Boolean(currentState);

export const getNextNodeActionMenuFocusIndex = ({
  currentIndex = 0,
  total = 0,
  key,
}: {
  currentIndex?: number;
  total?: number;
  key: string;
}): number => {
  if (!Number.isInteger(total) || total <= 0) return 0;

  if (key === "ArrowDown") {
    return (currentIndex + 1) % total;
  }

  if (key === "ArrowUp") {
    return (currentIndex - 1 + total) % total;
  }

  if (key === "Home") {
    return 0;
  }

  if (key === "End") {
    return total - 1;
  }

  return currentIndex;
};
