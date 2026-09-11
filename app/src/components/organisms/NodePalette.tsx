import { useEffect, useMemo, useState, type DragEvent } from "react";
import {
  Bookmark,
  CheckCircle,
  Frame,
  GitBranch,
  Globe,
  Package,
  Radio,
  Search,
  StickyNote,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { usePalette } from "../../contexts/PaletteContext";
import useNodePresetStore from "../../stores/NodePresetStore";
import {
  getNextNodeFilterValue,
  shouldClearNodeFilter,
} from "../../utils/nodeFilterBehavior";
import { NODE_MODAL_TYPE_LABELS } from "../../utils/nodeModalMeta";
import { presetDragTemplate } from "../../utils/nodePresets";
import { NodePaletteSection } from "./NodePaletteSection";
import type {
  ImportedItem,
  NodePaletteItem,
  NodePaletteProps,
  NodePaletteSection as NodePaletteSectionType,
} from "../../types";

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

export function NodePalette({
  workspaceId,
  onDragStart,
  onSelect,
  autoFocusFilter,
}: NodePaletteProps) {
  const [searchQuery, setSearchQuery] = useState("");
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

  const allSections = useMemo<NodePaletteSectionType[]>(() => {
    const sections = [...builtInNodePaletteSections];
    if (
      workspaceId &&
      loadedWorkspaceId === workspaceId &&
      presets.length > 0
    ) {
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

  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return allSections;
    const query = searchQuery.toLowerCase();
    return allSections.reduce<NodePaletteSectionType[]>((sections, section) => {
      const nodes = section.nodes.filter(
        (node) =>
          node.label.toLowerCase().includes(query) ||
          (node.method?.toLowerCase().includes(query) ?? false) ||
          node.description.toLowerCase().includes(query),
      );
      if (nodes.length > 0) sections.push({ ...section, nodes });
      return sections;
    }, []);
  }, [allSections, searchQuery]);

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
