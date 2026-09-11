import { useEffect, useMemo } from "react";
import {
  Bookmark,
  CheckCircle,
  Frame,
  GitBranch,
  Globe,
  Package,
  Radio,
  StickyNote,
} from "lucide-react";
import { usePalette } from "../contexts/PaletteContext";
import useNodePresetStore from "../stores/NodePresetStore";
import { NODE_MODAL_TYPE_LABELS } from "../utils/nodeModalMeta";
import { presetDragTemplate } from "../utils/nodePresets";
import type {
  ImportedItem,
  NodePaletteItem,
  NodePaletteSection as NodePaletteSectionType,
} from "../types";

export const builtInNodePaletteSections: readonly NodePaletteSectionType[] = [
  {
    key: "http-requests",
    title: "HTTP Requests",
    icon: Globe,
    nodes: [
      {
        type: "http-request",
        label: "GET Request",
        description: "Make a GET request",
        method: "GET",
      },
      {
        type: "http-request",
        label: "POST Request",
        description: "Make a POST request",
        method: "POST",
      },
      {
        type: "http-request",
        label: "PUT Request",
        description: "Make a PUT request",
        method: "PUT",
      },
      {
        type: "http-request",
        label: "DELETE Request",
        description: "Make a DELETE request",
        method: "DELETE",
      },
      {
        type: "http-request",
        label: "PATCH Request",
        description: "Make a PATCH request",
        method: "PATCH",
      },
    ],
  },
  {
    key: "streaming",
    title: "Streaming",
    icon: Radio,
    nodes: [
      {
        type: "sse",
        label: "SSE Stream",
        description: "Listen for events, then trigger and assert",
      },
    ],
  },
  {
    key: "control-flow",
    title: "Control Flow",
    icon: GitBranch,
    nodes: [
      {
        type: "delay",
        label: "Delay",
        description: "Add a delay before next step",
      },
      { type: "merge", label: "Merge", description: "Merge parallel branches" },
      {
        type: "workflow",
        label: "Call Workflow",
        description: "Run another workflow as a step",
      },
      { type: "end", label: "End", description: "Mark the end of workflow" },
    ],
  },
  {
    key: "validation",
    title: "Validation",
    icon: CheckCircle,
    nodes: [
      {
        type: "assertion",
        label: "Assertion",
        description: "Assert on conditional expressions",
      },
    ],
  },
  {
    key: "annotations",
    title: "Annotations",
    icon: StickyNote,
    nodes: [
      {
        type: "note",
        label: "Note",
        description: "Document a branch without running it",
      },
    ],
  },
  {
    key: "layout",
    title: "Layout",
    icon: Frame,
    nodes: [
      {
        type: "group",
        label: "Group Frame",
        description: "Organize related nodes",
      },
    ],
  },
];

/**
 * The palette's node catalogue: built-ins, the workspace's saved presets and
 * any imported OpenAPI groups. Shared by the side panel and the canvas
 * right-click menu so both stay in step.
 */
export function useNodePaletteSections(
  workspaceId: string,
): NodePaletteSectionType[] {
  const { importedGroups } = usePalette();
  const presets = useNodePresetStore((state) => state.presets);
  const loadedWorkspaceId = useNodePresetStore(
    (state) => state.loadedWorkspaceId,
  );
  const isLoadingPresets = useNodePresetStore((state) => state.isLoading);

  useEffect(() => {
    if (!workspaceId || loadedWorkspaceId === workspaceId || isLoadingPresets) {
      return;
    }
    void useNodePresetStore.getState().fetchPresets(workspaceId);
  }, [workspaceId, loadedWorkspaceId, isLoadingPresets]);

  return useMemo<NodePaletteSectionType[]>(() => {
    const sections = [...builtInNodePaletteSections];
    if (workspaceId && loadedWorkspaceId === workspaceId && presets.length > 0) {
      sections.push({
        key: "saved-presets",
        title: "Saved Presets",
        icon: Bookmark,
        nodes: presets.map((preset): NodePaletteItem => {
          const template = presetDragTemplate(preset);
          const method = template.config.method;
          return {
            type: preset.nodeType,
            label: preset.name,
            description: NODE_MODAL_TYPE_LABELS[preset.nodeType] ?? "Node",
            ...(preset.nodeType === "http-request" && typeof method === "string"
              ? { method }
              : {}),
            config: template.config,
            presetId: preset.presetId,
          };
        }),
      });
    }

    importedGroups.forEach((group) => {
      const items = group.items as Partial<ImportedItem>[];
      sections.push({
        key: `imported-${group.id}`,
        title: group.title,
        icon: Package,
        nodes: items.map((item): NodePaletteItem => ({
          type: "http-request",
          label: item.label ?? item.url ?? "Request",
          description: item.url ?? "",
          method: item.method ?? "GET",
          config: {
            method: item.method ?? "GET",
            url: item.url ?? "",
            queryParams: item.queryParams ?? "",
            pathVariables: item.pathVariables ?? "",
            headers: item.headers ?? "",
            cookies: item.cookies ?? "",
            body: item.body ?? "",
            timeout: item.timeout ?? 30,
            openapiMeta: item.openapiMeta ?? null,
          },
        })),
      });
    });
    return sections;
  }, [importedGroups, loadedWorkspaceId, presets, workspaceId]);
}

/** Keep only nodes whose label, method or description matches `query`. */
export function filterNodeSections(
  sections: readonly NodePaletteSectionType[],
  query: string,
): NodePaletteSectionType[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...sections];
  return sections.reduce<NodePaletteSectionType[]>((kept, section) => {
    const nodes = section.nodes.filter(
      (node) =>
        node.label.toLowerCase().includes(needle) ||
        (node.method?.toLowerCase().includes(needle) ?? false) ||
        node.description.toLowerCase().includes(needle),
    );
    if (nodes.length > 0) kept.push({ ...section, nodes });
    return kept;
  }, []);
}
