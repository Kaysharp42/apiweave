import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCloseOnOutsideOrEscape } from "../../hooks/useCloseOnOutsideOrEscape";
import { NodePalette } from "./NodePalette";
import type { CanvasNodeContextMenuProps } from "../../types";

const VIEWPORT_MARGIN = 8;

/** Flip away from the edge the menu would overflow, then clamp into view. */
function fitAxis(point: number, size: number, limit: number): number {
  const flipped = point + size + VIEWPORT_MARGIN > limit ? point - size : point;
  return Math.max(
    VIEWPORT_MARGIN,
    Math.min(flipped, limit - size - VIEWPORT_MARGIN),
  );
}

/** Compact quick-add menu anchored at the right-click point. */
export function CanvasNodeContextMenu({
  x,
  y,
  workspaceId,
  onSelect,
  onClose,
}: CanvasNodeContextMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useCloseOnOutsideOrEscape(true, () => onClose(), containerRef);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    setPosition({
      left: fitAxis(x, width, window.innerWidth),
      top: fitAxis(y, height, window.innerHeight),
    });
  }, [x, y]);

  return createPortal(
    <div
      ref={containerRef}
      role="menu"
      aria-label="Add node to canvas"
      className="fixed z-50 flex h-[min(55vh,380px)] w-64 flex-col overflow-hidden rounded-md border border-border bg-surface-raised shadow-overlay dark:border-border-dark dark:bg-surface-dark-raised"
      style={{ left: position.left, top: position.top }}
    >
      <NodePalette
        workspaceId={workspaceId}
        autoFocusFilter
        onSelect={(node) => {
          onSelect(node);
          onClose();
        }}
      />
    </div>,
    document.body,
  );
}
