import { memo, useRef, useState } from "react";
import { NodeResizer, useReactFlow } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { Frame, Ungroup } from "lucide-react";
import { IconButton } from "../atoms/IconButton";
import { ungroupFrames } from "../../utils/canvasGroups";
import type { CanvasNode } from "../../types/CanvasNode";
import { GROUP_TINTS, type GroupTint } from "../../constants/GroupTints";

/**
 * A frame drawn behind its members.
 *
 * Everything about this node is arranged around one rule: **a click inside a
 * frame must reach the canvas.** `pointer-events: none` on the whole node
 * (see `index.css`) is what lets a box-selection start inside a frame instead
 * of grabbing it; the pill, the actions and the resize handles put pointer
 * events back for themselves. The pill is also the node's `dragHandle`, so the
 * frame moves only when its name is dragged.
 *
 * The label counter-scales through `--aw-group-label-boost`, written on the
 * canvas root by `onMove` — a CSS variable rather than a React subscription so
 * zooming a graph with a dozen frames re-renders nothing.
 */
function GroupNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { updateNodeData, setNodes } = useReactFlow<CanvasNode>();
  const [isRenaming, setIsRenaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const tint = GROUP_TINTS[(data.config?.color as GroupTint) ?? "slate"];
  const label = typeof data.label === "string" ? data.label : "Group";

  return (
    <>
      <NodeResizer
        isVisible={selected ?? false}
        color={tint}
        minWidth={160}
        minHeight={120}
        // The dashed border below already is the outline; the resizer only
        // needs to contribute handles.
        lineStyle={{ borderColor: "transparent" }}
      />
      <div
        className="aw-group"
        style={{ "--aw-group-tint": tint } as React.CSSProperties}
        data-selected={selected ? "true" : "false"}
      >
        <div className="aw-group__bar">
          <span className="aw-group-handle aw-group__pill" title={label}>
            <Frame className="w-3 h-3 flex-shrink-0 opacity-70" />
            {isRenaming ? (
              <input
                ref={inputRef}
                autoFocus
                className="nodrag aw-group__input"
                defaultValue={label}
                onBlur={(event) => {
                  updateNodeData(id, { label: event.target.value.trim() || "Group" });
                  setIsRenaming(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") setIsRenaming(false);
                }}
              />
            ) : (
              <button
                type="button"
                // No `nodrag`: this button *is* the drag handle's surface, and
                // the whole pill is what moves the frame.
                className="aw-group__name"
                onDoubleClick={() => setIsRenaming(true)}
                aria-label={`Frame ${label} — double-click to rename`}
              >
                {label}
              </button>
            )}
          </span>

          {selected && (
            <span className="aw-group__actions nodrag">
              <IconButton
                size="xs"
                variant="ghost"
                tooltip="Ungroup"
                aria-label={`Ungroup ${label}`}
                // Through the same pure transform the keyboard path uses, so
                // there is one definition of what ungrouping does.
                onClick={() =>
                  setNodes((nodes) => ungroupFrames(nodes, new Set([id])))
                }
              >
                <Ungroup className="w-3 h-3" />
              </IconButton>
            </span>
          )}
        </div>
      </div>
    </>
  );
}

export default memo(GroupNode);
