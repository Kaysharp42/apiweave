import { useMemo, useState, type DragEvent } from "react";
import { Search, X } from "lucide-react";
import { toast } from "sonner";
import useNodePresetStore from "../../stores/NodePresetStore";
import {
  filterNodeSections,
  useNodePaletteSections,
} from "../../hooks/useNodePaletteSections";
import {
  getNextNodeFilterValue,
  shouldClearNodeFilter,
} from "../../utils/nodeFilterBehavior";
import { NodePaletteSection } from "./NodePaletteSection";
import type { NodePaletteItem, NodePaletteProps } from "../../types";

export function NodePalette({
  workspaceId,
  onDragStart,
  onSelect,
  autoFocusFilter,
}: NodePaletteProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const allSections = useNodePaletteSections(workspaceId);

  const renamePreset = (
    presetId: string,
    name: string,
    previous: string,
  ): void => {
    void useNodePresetStore
      .getState()
      .renamePreset(workspaceId, presetId, name)
      .then(() => toast.success(`Renamed preset to "${name}"`))
      .catch((error: unknown) =>
        toast.error(
          error instanceof Error
            ? `Could not rename "${previous}": ${error.message}`
            : `Could not rename "${previous}"`,
        ),
      );
  };

  const deletePreset = (presetId: string, name: string): void => {
    void useNodePresetStore
      .getState()
      .deletePreset(workspaceId, presetId)
      .then(() => toast.success(`Deleted preset "${name}"`))
      .catch((error: unknown) =>
        toast.error(
          error instanceof Error
            ? `Could not delete preset: ${error.message}`
            : "Could not delete preset",
        ),
      );
  };

  const filteredSections = useMemo(
    () => filterNodeSections(allSections, searchQuery),
    [allSections, searchQuery],
  );

  const handleDragStart = (event: DragEvent, node: NodePaletteItem): void => {
    event.dataTransfer.setData("application/reactflow", node.type);
    if (node.method) {
      event.dataTransfer.setData("application/reactflow-method", node.method);
    }
    if (node.config) {
      event.dataTransfer.setData(
        "application/reactflow-node-template",
        JSON.stringify({
          type: node.type,
          label: node.label,
          config: node.config,
        }),
      );
    }
    event.dataTransfer.effectAllowed = "move";
    onDragStart?.();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border p-3 dark:border-border-dark">
        <h3 className="mb-2 text-sm font-semibold tracking-[-0.01em] text-text-primary dark:text-text-primary-dark">
          Add Nodes
          <span className="ml-1 text-xs font-normal text-text-muted dark:text-text-muted-dark">
            — click or drag
          </span>
        </h3>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted dark:text-text-muted-dark" />
          <input
            type="text"
            autoFocus={autoFocusFilter}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            aria-label="Filter nodes"
            onKeyDown={(event) => {
              if (shouldClearNodeFilter({ key: event.key })) {
                setSearchQuery((currentValue) =>
                  getNextNodeFilterValue({ currentValue, key: event.key }),
                );
              }
            }}
            placeholder="Filter nodes…"
            className="w-full rounded-sm border border-border bg-surface py-1.5 pl-8 pr-8 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary dark:border-border-dark dark:bg-surface-dark dark:text-text-primary-dark dark:placeholder:text-text-muted-dark"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() =>
                setSearchQuery((currentValue) =>
                  getNextNodeFilterValue({
                    currentValue,
                    clearRequested: true,
                  }),
                )
              }
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary focus-visible:outline-2 focus-visible:outline-primary dark:text-text-muted-dark dark:hover:bg-surface-dark-overlay dark:hover:text-text-primary-dark dark:focus-visible:outline-primary-light"
              aria-label="Clear node filter"
              title="Clear filter"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filteredSections.length === 0 ? (
          <div className="p-4 text-center text-sm text-text-muted dark:text-text-muted-dark">
            No nodes match &quot;{searchQuery}&quot;
          </div>
        ) : (
          filteredSections.map((section) => (
            <NodePaletteSection
              key={section.key}
              section={section}
              onDragStart={handleDragStart}
              onSelect={onSelect}
              onRenamePreset={renamePreset}
              onDeletePreset={deletePreset}
              defaultOpen={!searchQuery}
            />
          ))
        )}
      </div>
    </div>
  );
}
