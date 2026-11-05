import { Frame, Redo2, Undo2, Ungroup } from "lucide-react";
import { IconButton } from "../atoms/IconButton";
import { CanvasToolbarDivider } from "./CanvasToolbarDivider";
import type { CanvasToolbarStructureActionsProps } from "../../types";

/**
 * Undo, redo, frame and ungroup: the structure edits.
 *
 * Icon-only at every density, like the camera lock: undo is a reflex, and a
 * reflex two clicks deep in an overflow menu is not one. The disabled state is
 * the only affordance telling you whether there is anything left to undo. At
 * the last tier the bar has run out of room for that argument — the buttons
 * move into the menu so Run keeps its place.
 */
export function CanvasToolbarStructureActions({
  canUndo,
  canRedo,
  canGroup,
  canUngroup,
  onUndo,
  onRedo,
  onGroup,
  onUngroup,
}: CanvasToolbarStructureActionsProps) {
  return (
    <>
      <div className="flex shrink-0 items-center">
        <IconButton
          onClick={onUndo}
          disabled={!canUndo}
          tooltip="Undo (Ctrl+Z)"
          aria-label="Undo"
          variant="ghost"
          size="sm"
        >
          <Undo2 className="w-4 h-4" />
        </IconButton>
        <IconButton
          onClick={onRedo}
          disabled={!canRedo}
          tooltip="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
          variant="ghost"
          size="sm"
        >
          <Redo2 className="w-4 h-4" />
        </IconButton>
      </div>

      <CanvasToolbarDivider />

      <div className="flex shrink-0 items-center">
        <IconButton
          onClick={onGroup}
          disabled={!canGroup}
          tooltip={
            canGroup
              ? "Frame selection (Ctrl+G)"
              : "Select two ungrouped nodes to frame"
          }
          aria-label="Frame selection"
          variant="ghost"
          size="sm"
        >
          <Frame className="w-4 h-4" />
        </IconButton>
        <IconButton
          onClick={onUngroup}
          disabled={!canUngroup}
          tooltip={
            canUngroup
              ? "Ungroup selection (Ctrl+Shift+G)"
              : "Select a frame or framed node to ungroup"
          }
          aria-label="Ungroup selection"
          variant="ghost"
          size="sm"
        >
          <Ungroup className="w-4 h-4" />
        </IconButton>
      </div>

      <CanvasToolbarDivider />
    </>
  );
}
