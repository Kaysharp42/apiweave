import type { NodePreset } from "../types/NodePreset";
import type { NodePresetNodeType } from "../types/NodePresetNodeType";

/**
 * Canvas node types that can be saved to the workspace preset library. Mirrors
 * `NodePresetNodeTypeSchema` on the desktop side — `start`/`end` are absent
 * because they carry no config.
 */
export const PRESETABLE_NODE_TYPES: readonly NodePresetNodeType[] = [
  "http-request",
  "assertion",
  "delay",
  "merge",
  "workflow",
];

/** Narrow a ReactFlow node type to a preset node type, or `null` if it can't be a preset. */
export const asPresetNodeType = (
  nodeType: string | undefined,
): NodePresetNodeType | null =>
  PRESETABLE_NODE_TYPES.find((candidate) => candidate === nodeType) ?? null;

/**
 * The drag payload a preset contributes to the Add Nodes palette — the same
 * `{type, label, config}` shape `useCanvasDrop` already reads from
 * `application/reactflow-node-template`, so a preset drops through the existing
 * path with no special-casing.
 */
export const presetDragTemplate = (
  preset: NodePreset,
): { type: string; label: string; config: Record<string, unknown> } => ({
  type: preset.nodeType,
  label: preset.name,
  config: { ...preset.config },
});
