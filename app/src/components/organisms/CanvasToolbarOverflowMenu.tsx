import {
  Code,
  Command,
  Frame,
  ListChecks,
  MoreHorizontal,
  Redo2,
  Undo2,
  Ungroup,
  Upload,
} from "lucide-react";
import {
  Menu,
  MenuButton,
  MenuItems,
  MenuSeparator,
} from "@headlessui/react";
import { Button } from "../atoms/Button";
import { shortcutLabel } from "../../constants/keyboardShortcuts";
import { CanvasToolbarMenuItem } from "./CanvasToolbarMenuItem";
import type { CanvasToolbarOverflowMenuProps } from "../../types";

/** The toolbar's `⋯` menu: whatever the current density could not keep inline. */
export function CanvasToolbarOverflowMenu({
  showStructureInline,
  canUndo,
  canRedo,
  canGroup,
  canUngroup,
  onUndo,
  onRedo,
  onGroup,
  onUngroup,
  onCommandPalette,
  showHistoryInline,
  onHistory,
  onJsonEditor,
  onImport,
}: CanvasToolbarOverflowMenuProps) {
  return (
    <Menu>
      {/* `p-0!` rather than `p-0`: Button's size class sets
          `padding-inline` after `padding`, so a plain `p-0` leaves the
          32px box with 8px of content and squeezes the glyph. */}
      <MenuButton
        as={Button}
        variant="ghost"
        size="sm"
        aria-label="More actions"
        className="h-8 w-8 shrink-0 p-0!"
      >
        <MoreHorizontal className="h-4 w-4 shrink-0" />
      </MenuButton>

      <MenuItems
        anchor="bottom start"
        aria-label="More actions"
        className="z-50 min-w-[180px] overflow-hidden rounded-xs border border-border bg-surface-raised py-1 shadow-node focus:outline-hidden dark:border-border-dark dark:bg-surface-dark-raised"
      >
        {!showStructureInline && (
          <>
            <CanvasToolbarMenuItem
              icon={Undo2}
              label="Undo"
              shortcut={shortcutLabel("undo")}
              disabled={!canUndo}
              onSelect={onUndo}
            />
            <CanvasToolbarMenuItem
              icon={Redo2}
              label="Redo"
              shortcut={shortcutLabel("redo")}
              disabled={!canRedo}
              onSelect={onRedo}
            />
            <CanvasToolbarMenuItem
              icon={Frame}
              label="Frame selection"
              shortcut={shortcutLabel("group")}
              disabled={!canGroup}
              onSelect={onGroup}
            />
            <CanvasToolbarMenuItem
              icon={Ungroup}
              label="Ungroup selection"
              shortcut={shortcutLabel("ungroup")}
              disabled={!canUngroup}
              onSelect={onUngroup}
            />
            <MenuSeparator className="h-px bg-border dark:bg-border-dark" />
          </>
        )}
        <CanvasToolbarMenuItem
          icon={Command}
          label="Command palette"
          shortcut={shortcutLabel("openCommandPalette")}
          onSelect={onCommandPalette}
        />
        {!showHistoryInline && (
          <CanvasToolbarMenuItem
            icon={ListChecks}
            label="Run history"
            onSelect={onHistory}
          />
        )}
        <CanvasToolbarMenuItem
          icon={Code}
          label="JSON editor"
          shortcut={shortcutLabel("toggleJsonEditor")}
          onSelect={onJsonEditor}
        />
        <CanvasToolbarMenuItem
          icon={Upload}
          label="Import nodes"
          onSelect={onImport}
        />
      </MenuItems>
    </Menu>
  );
}
