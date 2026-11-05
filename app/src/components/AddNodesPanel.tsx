import { useEffect, useState } from "react";
import { Popover, Transition } from "@headlessui/react";
import { PanelRightOpen, Plus, X } from "lucide-react";
import { NodePalette } from "./organisms/NodePalette";
import { Tooltip } from "./atoms/Tooltip";
import useNodePresetStore from "../stores/NodePresetStore";
import useCanvasPrefsStore from "../stores/CanvasPrefsStore";
import {
  canvasActionsBottom,
  CanvasCornerGutter,
} from "../constants/CanvasChrome";
import type { AddNodesPanelProps } from "../types";

/** The canvas action button and drag-oriented node palette. */
export default function AddNodesPanel({
  isModalOpen = false,
  showVariablesPanel = false,
  onShowVariablesPanel = () => {},
  workspaceId = "",
  onAddNode = () => {},
}: AddNodesPanelProps) {
  const [paletteKey, setPaletteKey] = useState(0);
  const loadedWorkspaceId = useNodePresetStore(
    (state) => state.loadedWorkspaceId,
  );
  const isLoadingPresets = useNodePresetStore((state) => state.isLoading);
  const minimapVisible = useCanvasPrefsStore((state) => state.minimapVisible);

  useEffect(() => {
    if (!workspaceId || loadedWorkspaceId === workspaceId || isLoadingPresets) {
      return;
    }
    void useNodePresetStore.getState().fetchPresets(workspaceId);
  }, [isLoadingPresets, loadedWorkspaceId, workspaceId]);

  return (
    <div
      style={{
        bottom: canvasActionsBottom(minimapVisible),
        right: CanvasCornerGutter,
      }}
      className={`absolute z-30 flex flex-col items-end gap-2 ${
        isModalOpen ? "pointer-events-none opacity-0" : "opacity-100"
      } transition-opacity duration-200 motion-reduce:transition-none`}
    >
      {!showVariablesPanel && (
        <Tooltip content="Show Side Panel (Variables, Functions, Settings)">
          <button
            type="button"
            onClick={() => onShowVariablesPanel(true)}
            className="flex h-9 w-9 items-center justify-center rounded-xs border border-border bg-surface-raised text-primary shadow-node transition-colors hover:bg-surface-overlay focus-visible:outline-2 focus-visible:outline-(--aw-primary) dark:border-border-dark dark:bg-surface-dark-raised dark:text-primary-light dark:hover:bg-surface-dark-overlay"
            aria-label="Show panel"
          >
            <PanelRightOpen className="h-4 w-4" />
          </button>
        </Tooltip>
      )}

      <Popover>
        {({ open, close }) => (
          <>
            <Tooltip content={open ? "Close node palette" : "Add node"}>
              <Popover.Button
                disabled={isModalOpen}
                className="flex h-9 w-9 items-center justify-center rounded-xs border border-(--aw-primary) bg-(--aw-primary) text-on-primary shadow-node transition-colors hover:bg-(--aw-primary-hover) focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:outline-offset-(--aw-focus-ring-offset) disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={open ? "Close node palette" : "Add nodes"}
              >
                {open ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              </Popover.Button>
            </Tooltip>

            <Transition
              enter="transition duration-150 ease-out motion-reduce:transition-none"
              enterFrom="opacity-0 translate-y-2 scale-95"
              enterTo="opacity-100 translate-y-0 scale-100"
              leave="transition duration-100 ease-in motion-reduce:transition-none"
              leaveFrom="opacity-100 translate-y-0 scale-100"
              leaveTo="opacity-0 translate-y-2 scale-95"
              afterLeave={() => setPaletteKey((currentKey) => currentKey + 1)}
            >
              <Popover.Panel
                anchor={{ to: "top end", gap: 8, padding: 12 }}
                className="z-50 flex h-[min(60vh,640px)] w-72 flex-col overflow-hidden rounded-xs border border-border bg-surface-raised shadow-node dark:border-border-dark dark:bg-surface-dark-raised"
              >
                <NodePalette
                  key={paletteKey}
                  workspaceId={workspaceId}
                  onDragStart={() => window.setTimeout(close, 100)}
                  onSelect={(node) => {
                    onAddNode(node);
                    close();
                  }}
                />
              </Popover.Panel>
            </Transition>
          </>
        )}
      </Popover>
    </div>
  );
}
