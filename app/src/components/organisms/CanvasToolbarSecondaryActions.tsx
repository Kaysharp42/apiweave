import { Code, Command, History, ListChecks, Upload } from "lucide-react";
import { IconButton } from "../atoms/IconButton";
import { CanvasToolbarButton } from "./CanvasToolbarButton";
import { CanvasToolbarCameraLock } from "./CanvasToolbarCameraLock";
import { CanvasToolbarOverflowMenu } from "./CanvasToolbarOverflowMenu";
import type { CanvasToolbarSecondaryActionsProps } from "../../types";

/** Command palette, history, JSON and import, plus the menu they fold into and the camera lock. */
export function CanvasToolbarSecondaryActions({
  showLabels,
  showSecondaryInline,
  showHistoryInline,
  showOverflow,
  onCommandPalette,
  onHistory,
  onVersionHistory,
  onJsonEditor,
  onImport,
  overflow,
}: CanvasToolbarSecondaryActionsProps) {
  return (
    <div className="flex shrink-0 items-center">
      {showSecondaryInline && (
        <IconButton
          onClick={onCommandPalette}
          tooltip="Command palette (Ctrl+K)"
          aria-label="Open command palette"
          variant="ghost"
          size="sm"
        >
          <Command className="w-4 h-4" />
        </IconButton>
      )}
      {showHistoryInline && (
        <CanvasToolbarButton
          icon={ListChecks}
          label="Run history"
          onClick={onHistory}
          tooltip="Run history"
          showLabel={showLabels}
        />
      )}
      {/* Icon-only at every density, like undo: it is the undo for what
          undo cannot reach — a save, an agent's edit, a sync. */}
      <IconButton
        onClick={onVersionHistory}
        tooltip="Version history"
        aria-label="Version history"
        variant="ghost"
        size="sm"
      >
        <History className="w-4 h-4" />
      </IconButton>
      {showSecondaryInline && (
        <>
          <CanvasToolbarButton
            icon={Code}
            label="JSON"
            onClick={onJsonEditor}
            tooltip="JSON editor (Ctrl+J)"
            showLabel={showLabels}
          />
          <CanvasToolbarButton
            icon={Upload}
            label="Import"
            onClick={onImport}
            tooltip="Import nodes"
            showLabel={showLabels}
          />
        </>
      )}
      {showOverflow && <CanvasToolbarOverflowMenu {...overflow} />}
      <CanvasToolbarCameraLock />
    </div>
  );
}
