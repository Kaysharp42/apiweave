import { useEffect, useState } from "react";
import { Popover, Transition } from "@headlessui/react";
import { PanelRightOpen, Plus, X } from "lucide-react";
import { NodePalette } from "./organisms/NodePalette";
import useNodePresetStore from "../stores/NodePresetStore";
import {
  CanvasActionsBottom,
  CanvasCornerGutter,
} from "../constants/CanvasChrome";
import type { AddNodesPanelProps } from "../types";

const actionStackStyle = {
  bottom: CanvasActionsBottom,
  right: CanvasCornerGutter,
};

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

  useEffect(() => {
    if (!workspaceId || loadedWorkspaceId === workspaceId || isLoadingPresets) {
      return;
    }
    void useNodePresetStore.getState().fetchPresets(workspaceId);
  }, [isLoadingPresets, loadedWorkspaceId, workspaceId]);

  return (
    <div
      style={actionStackStyle}
      className={`absolute z-30 flex flex-col items-end gap-2 ${
        isModalOpen ? "pointer-events-none opacity-0" : "opacity-100"
      } transition-opacity duration-200 motion-reduce:transition-none`}
    >
      {!showVariablesPanel && (
        <button
          type="button"
          onClick={() => onShowVariablesPanel(true)}
          className="flex h-9 w-9 items-center justify-center rounded-sm border border-border bg-surface-raised text-primary shadow-node transition-colors hover:bg-surface-overlay focus-visible:outline-2 focus-visible:outline-primary dark:border-border-dark dark:bg-surface-dark-raised dark:text-primary-light dark:hover:bg-surface-dark-overlay dark:focus-visible:outline-primary-light"
          title="Show Side Panel (Variables, Functions, Settings)"
          aria-label="Show panel"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
      )}

      <Popover>
        {({ open, close }) => (
          <>
            <Popover.Button
              disabled={isModalOpen}
              className="flex h-9 w-9 items-center justify-center rounded-sm border border-primary bg-primary text-surface-raised shadow-node transition-colors hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50 dark:bg-primary-light dark:text-surface-dark-raised"
              aria-label={open ? "Close node palette" : "Add nodes"}
            >
              {open ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            </Popover.Button>

            <Transition
              enter="transition duration-150 ease-out"
              enterFrom="opacity-0 translate-y-2 scale-95"
              enterTo="opacity-100 translate-y-0 scale-100"
              leave="transition duration-100 ease-in"
              leaveFrom="opacity-100 translate-y-0 scale-100"
              leaveTo="opacity-0 translate-y-2 scale-95"
              afterLeave={() => setPaletteKey((currentKey) => currentKey + 1)}
            >
              <Popover.Panel
                anchor={{ to: "top end", gap: 8, padding: 12 }}
                className="z-50 flex h-[min(60vh,640px)] w-72 flex-col overflow-hidden rounded-sm border border-border bg-surface-raised shadow-node dark:border-border-dark dark:bg-surface-dark-raised"
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
