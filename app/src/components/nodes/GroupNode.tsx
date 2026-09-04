import { memo, useRef, useState } from "react";
import { NodeResizer, useReactFlow } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { Frame, Ungroup } from "lucide-react";
import { IconButton } from "../atoms/IconButton";
import { useNodeConfigPatch } from "../../hooks/useNodeConfigPatch";
import {
  FRAME_MIN_HEIGHT,
  FRAME_MIN_WIDTH,
  ungroupFrames,
} from "../../utils/canvasGroups";
import type { CanvasNode } from "../../types/CanvasNode";
import { GROUP_TINTS } from "../../constants/GroupTints";
import type { GroupTint } from "../../types/GroupTint";

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
  const patchConfig = useNodeConfigPatch(id);
  const [isRenaming, setIsRenaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // A stored name that is no longer a tint (renamed token, hand-edited file)
  // would leave `--aw-group-tint` undefined and collapse every color-mix that
  // draws this node, so it falls back rather than rendering an invisible frame.
  const stored = data.config?.color;
  const tintName: GroupTint =
    typeof stored === "string" && stored in GROUP_TINTS
      ? (stored as GroupTint)
      : "slate";
  const tint = GROUP_TINTS[tintName];
  const label = typeof data.label === "string" ? data.label : "Group";

  return (
    <>
      <NodeResizer
        isVisible={selected ?? false}
        color={tint}
        minWidth={FRAME_MIN_WIDTH}
        minHeight={FRAME_MIN_HEIGHT}
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
              <span className="aw-group__tints" role="group" aria-label={`Tint for ${label}`}>
                {(Object.keys(GROUP_TINTS) as GroupTint[]).map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="aw-group__swatch"
                    style={{ "--aw-swatch": GROUP_TINTS[name] } as React.CSSProperties}
                    data-active={name === tintName ? "true" : "false"}
                    aria-pressed={name === tintName}
                    aria-label={name}
                    title={name}
                    onClick={() => patchConfig("color", name)}
                  />
                ))}
              </span>
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
