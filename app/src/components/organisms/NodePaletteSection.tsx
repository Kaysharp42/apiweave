import { useState, type DragEvent } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { NodePaletteMethodBadge } from "../../constants/NodePalette";
import type { NodePaletteItem, NodePaletteSectionProps } from "../../types";

export function NodePaletteSection({
  section,
  onDragStart,
  onSelect,
  onRenamePreset,
  onDeletePreset,
  defaultOpen,
}: NodePaletteSectionProps) {
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const Icon = section.icon;

  const commitRename = (presetId: string, previous: string): void => {
    const trimmed = draftName.trim();
    setEditingPresetId(null);
    if (!trimmed || trimmed === previous) return;
    onRenamePreset(presetId, trimmed, previous);
  };

  const handleDragStart = (event: DragEvent, node: NodePaletteItem): void => {
    onDragStart(event, node);
  };

  return (
    <div className="collapse collapse-arrow rounded-none border-b border-border dark:border-border-dark last:border-b-0">
      <input
        type="checkbox"
        defaultChecked={defaultOpen}
        aria-label={`Toggle ${section.title}`}
      />
      <div className="collapse-title text-sm font-medium py-2 min-h-0 flex items-center gap-2 text-text-primary dark:text-text-primary-dark">
        <Icon className="w-4 h-4 text-text-secondary dark:text-text-secondary-dark flex-shrink-0" />
        <span>{section.title}</span>
        <span className="ml-auto rounded-full border border-border dark:border-border-dark px-1.5 py-0.5 text-[9px] font-mono text-text-muted dark:text-text-muted-dark">
          {section.nodes.length}
        </span>
      </div>
      <div className="collapse-content px-2 pb-1">
        <div className="space-y-0.5">
          {section.nodes.map((node) => {
            const isEditing = node.presetId === editingPresetId;
            const showPresetActions = node.presetId !== undefined && !isEditing;
            const rowClassName =
              "group flex w-full flex-col gap-0.5 rounded-sm border border-transparent px-2.5 py-1.5 text-left transition-colors motion-reduce:transition-none hover:border-border hover:bg-surface-overlay dark:hover:border-border-dark dark:hover:bg-surface-dark-overlay";

            const nodeContents = (
              <>
                <div className="flex items-center gap-1.5 text-sm text-text-primary dark:text-text-primary-dark">
                  {node.method && (
                    <span
                      className={`inline-block px-1.5 py-0.5 text-[10px] font-mono border rounded-sm ${NodePaletteMethodBadge[node.method] ?? "text-primary bg-primary/10 border-primary/30"}`}
                    >
                      {node.method}
                    </span>
                  )}
                  {isEditing ? (
                    <input
                      autoFocus
                      type="text"
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter") {
                          commitRename(node.presetId!, node.label);
                        } else if (event.key === "Escape") {
                          setEditingPresetId(null);
                        }
                      }}
                      onBlur={() => setEditingPresetId(null)}
                      aria-label={`New name for ${node.label}`}
                      className="min-w-0 flex-1 rounded-sm border border-border bg-surface-raised px-1.5 py-0.5 text-sm text-text-primary transition-[border-color,outline] duration-[var(--aw-transition-fast)] focus:border-primary focus:outline-none focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] motion-reduce:transition-none dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark dark:focus:border-primary-light"
                    />
                  ) : (
                    <span className="font-medium truncate">{node.label}</span>
                  )}
                  {showPresetActions && (
                    <span className="ml-auto flex flex-shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDraftName(node.label);
                          setEditingPresetId(node.presetId!);
                        }}
                        className="rounded-sm p-0.5 text-text-muted opacity-0 transition-colors hover:bg-surface-overlay hover:text-text-primary focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] group-hover:opacity-100 motion-reduce:transition-none dark:text-text-muted-dark dark:hover:bg-surface-dark-overlay dark:hover:text-text-primary-dark"
                        title={`Rename preset \"${node.label}\"`}
                        aria-label={`Rename preset ${node.label}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeletePreset(node.presetId!, node.label);
                        }}
                        className="rounded-sm p-0.5 text-text-muted opacity-0 transition-colors hover:bg-status-error/10 hover:text-status-error focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] group-hover:opacity-100 motion-reduce:transition-none dark:text-text-muted-dark"
                        title={`Delete preset \"${node.label}\"`}
                        aria-label={`Delete preset ${node.label}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  )}
                </div>
                {node.description && (
                  <span className="text-xs text-text-muted dark:text-text-muted-dark truncate">
                    {node.description}
                  </span>
                )}
              </>
            );

            return (
              <div
                key={node.presetId ?? `${node.type}-${node.label}`}
                role="menuitem"
                tabIndex={isEditing ? -1 : 0}
                draggable={!isEditing}
                onDragStart={(event) => handleDragStart(event, node)}
                onClick={() => {
                  if (!isEditing) onSelect(node);
                }}
                onKeyDown={(event) => {
                  if (isEditing || (event.key !== "Enter" && event.key !== " "))
                    return;
                  event.preventDefault();
                  onSelect(node);
                }}
                className={`${rowClassName} cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[-2px] active:cursor-grabbing`}
                title={`Click to add ${node.label}, or drag it onto the canvas`}
              >
                {nodeContents}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
