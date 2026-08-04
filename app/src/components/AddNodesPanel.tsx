import { useEffect, useState, useMemo, type DragEvent } from "react";
import { Popover, Transition } from "@headlessui/react";
import {
  X,
  Plus,
  PanelRightOpen,
  Search,
  Globe,
  GitBranch,
  CheckCircle,
  Bookmark,
  Package,
  Pencil,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { usePalette } from "../contexts/PaletteContext";
import useNodePresetStore from "../stores/NodePresetStore";
import {
  getNextNodeFilterValue,
  shouldClearNodeFilter,
} from "../utils/nodeFilterBehavior";
import { presetDragTemplate } from "../utils/nodePresets";
import { NODE_MODAL_TYPE_LABELS } from "../utils/nodeModalMeta";
import {
  CanvasActionsBottom,
  CanvasCornerGutter,
} from "../constants/CanvasChrome";
import type { AddNodesPanelProps } from "../types";

/**
 * Anchored to the canvas rather than the window: the canvas is one pane of a
 * split, so a viewport-fixed stack drifted over the minimap and, once the
 * variables panel opened, over the panel too.
 */
const actionStackStyle = {
  bottom: CanvasActionsBottom,
  right: CanvasCornerGutter,
};

const methodBadge: Record<string, string> = {
  GET: "text-method-get bg-method-get/10 border-method-get/30",
  POST: "text-method-post bg-method-post/10 border-method-post/30",
  PUT: "text-method-put bg-method-put/10 border-method-put/30",
  DELETE: "text-method-delete bg-method-delete/10 border-method-delete/30",
  PATCH: "text-method-patch bg-method-patch/10 border-method-patch/30",
  HEAD: "text-method-head bg-method-head/10 border-method-head/30",
  OPTIONS: "text-method-options bg-method-options/10 border-method-options/30",
};

const sectionIcons: Record<string, LucideIcon> = {
  "HTTP Requests": Globe,
  "Control Flow": GitBranch,
  Validation: CheckCircle,
};

interface PaletteItem {
  method?: string;
  label?: string;
  url?: string;
  queryParams?: string;
  pathVariables?: string;
  headers?: string;
  cookies?: string;
  body?: string;
  timeout?: number;
  openapiMeta?: Record<string, unknown> | null;
}

interface ImportedGroup {
  id: string;
  title: string;
  items?: unknown[];
}

interface NodeTemplate {
  type: string;
  label: string;
  description: string;
  method?: string;
  template?: Record<string, unknown>;
  /** Set only on saved-preset entries — enables the per-item delete affordance. */
  presetId?: string;
}

interface NodeSection {
  key: string;
  title: string;
  icon: LucideIcon;
  nodes: NodeTemplate[];
}

const nodeTemplates: { category: string; nodes: NodeTemplate[] }[] = [
  {
    category: "HTTP Requests",
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
    category: "Control Flow",
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
    category: "Validation",
    nodes: [
      {
        type: "assertion",
        label: "Assertion",
        description: "Assert on conditional expressions",
      },
    ],
  },
];

export default function AddNodesPanel({
  isModalOpen = false,
  showVariablesPanel = false,
  onShowVariablesPanel = () => {},
  workspaceId = "",
}: AddNodesPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const { importedGroups } = usePalette();
  const presets = useNodePresetStore((s) => s.presets);
  const loadedWorkspaceId = useNodePresetStore((s) => s.loadedWorkspaceId);

  useEffect(() => {
    if (!workspaceId || loadedWorkspaceId === workspaceId) return;
    void useNodePresetStore.getState().fetchPresets(workspaceId);
  }, [workspaceId, loadedWorkspaceId]);

  const renamePreset = (presetId: string, name: string, previous: string) => {
    void useNodePresetStore
      .getState()
      .renamePreset(workspaceId, presetId, name)
      .then(() => toast.success(`Renamed preset to "${name}"`))
      .catch((err: unknown) =>
        toast.error(
          err instanceof Error
            ? `Could not rename "${previous}": ${err.message}`
            : `Could not rename "${previous}"`,
        ),
      );
  };

  const deletePreset = (presetId: string, name: string) => {
    void useNodePresetStore
      .getState()
      .deletePreset(workspaceId, presetId)
      .then(() => toast.success(`Deleted preset "${name}"`))
      .catch((err: unknown) =>
        toast.error(
          err instanceof Error
            ? `Could not delete preset: ${err.message}`
            : "Could not delete preset",
        ),
      );
  };

  const allSections = useMemo<NodeSection[]>(() => {
    const sections: NodeSection[] = nodeTemplates.map((cat) => ({
      key: cat.category,
      title: cat.category,
      icon: sectionIcons[cat.category] ?? Package,
      nodes: cat.nodes as NodeTemplate[],
    }));

    // Saved presets: persisted and workspace-wide, unlike the ephemeral
    // Swagger-imported groups below. Only shown once the workspace's presets
    // have actually loaded and there is at least one.
    if (workspaceId && loadedWorkspaceId === workspaceId && presets.length > 0) {
      sections.push({
        key: "saved-presets",
        title: "Saved Presets",
        icon: Bookmark,
        nodes: presets.map((preset): NodeTemplate => {
          const template = presetDragTemplate(preset);
          const method = template.config["method"];
          return {
            type: preset.nodeType,
            label: preset.name,
            description: NODE_MODAL_TYPE_LABELS[preset.nodeType] ?? "Node",
            ...(preset.nodeType === "http-request" && typeof method === "string"
              ? { method }
              : {}),
            template,
            presetId: preset.presetId,
          };
        }),
      });
    }

    importedGroups.forEach((group: ImportedGroup) => {
      const items = (group.items ?? []) as PaletteItem[];
      const importedNodes: NodeTemplate[] = items.map(
        (item): NodeTemplate => ({
          type: "http-request",
          label: item.label ?? item.url ?? "Request",
          description: item.url ?? "",
          method: item.method ?? "GET",
          template: {
            type: "http-request",
            label: item.label ?? item.url ?? "Request",
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
          },
        }),
      );
      sections.push({
        key: `imported-${group.id}`,
        title: group.title,
        icon: Package,
        nodes: importedNodes,
      });
    });

    return sections;
  }, [importedGroups, presets, loadedWorkspaceId, workspaceId]);

  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return allSections;
    const q = searchQuery.toLowerCase();
    return allSections.reduce<NodeSection[]>((sections, sec) => {
      const nodes = sec.nodes.filter(
        (n) =>
          n.label.toLowerCase().includes(q) ||
          (n.method && n.method.toLowerCase().includes(q)) ||
          (n.description && n.description.toLowerCase().includes(q)),
      );
      if (nodes.length > 0) sections.push({ ...sec, nodes });
      return sections;
    }, []);
  }, [allSections, searchQuery]);

  const onDragStart = (event: DragEvent, node: NodeTemplate) => {
    event.dataTransfer.setData("application/reactflow", node.type);
    if (node.method) {
      event.dataTransfer.setData("application/reactflow-method", node.method);
    }
    if (node.template) {
      try {
        event.dataTransfer.setData(
          "application/reactflow-node-template",
          JSON.stringify(node.template),
        );
      } catch {
        // Ignore serialization errors
      }
    }
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <div
      style={actionStackStyle}
      className={`absolute z-30 flex flex-col items-end gap-2 ${
        isModalOpen ? "opacity-0 pointer-events-none" : "opacity-100"
      } transition-opacity duration-200 motion-reduce:transition-none`}
    >
      {!showVariablesPanel && (
        <button
          type="button"
          onClick={() => onShowVariablesPanel(true)}
          className="flex items-center justify-center w-9 h-9 rounded-sm bg-surface-raised dark:bg-surface-dark-raised text-primary dark:text-primary-light border border-border dark:border-border-dark shadow-node hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors motion-reduce:transition-none"
          title="Show Side Panel (Variables, Functions, Settings)"
          aria-label="Show panel"
        >
          <PanelRightOpen className="w-4 h-4" />
        </button>
      )}

      <Popover>
        {({ open, close }) => (
          <>
            <Popover.Button
              disabled={isModalOpen}
              className="flex items-center justify-center w-9 h-9 rounded-sm border border-primary bg-primary dark:bg-primary-light text-surface-raised dark:text-surface-dark-raised shadow-node hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors motion-reduce:transition-none"
              aria-label={open ? "Close node palette" : "Add nodes"}
            >
              {open ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            </Popover.Button>

            <Transition
              enter="transition duration-150 ease-out"
              enterFrom="opacity-0 translate-y-2 scale-95"
              enterTo="opacity-100 translate-y-0 scale-100"
              leave="transition duration-100 ease-in"
              leaveFrom="opacity-100 translate-y-0 scale-100"
              leaveTo="opacity-0 translate-y-2 scale-95"
              afterLeave={() => {
                setSearchQuery((currentValue) =>
                  getNextNodeFilterValue({
                    currentValue,
                    isPaletteClosing: true,
                  }),
                );
              }}
            >
              {/* Anchored, so Headless UI portals it and floating-ui caps its
                  height to the space actually available. Left in flow it grew
                  upward into the canvas's overflow-hidden edge and clipped.
                  --anchor-max-height is the ceiling that cap is taken against;
                  without it the palette fills all the way to the window top and
                  covers the header. */}
              <Popover.Panel
                anchor={{ to: "top end", gap: 8, padding: 12 }}
                className="z-50 flex w-72 flex-col rounded-sm border border-border bg-surface-raised shadow-node [--anchor-max-height:60vh] dark:border-border-dark dark:bg-surface-dark-raised"
              >
                <div className="p-3 border-b border-border dark:border-border-dark">
                  <h3 className="text-sm font-semibold text-text-primary dark:text-text-primary-dark mb-2 tracking-[-0.01em]">
                    Add Nodes
                    <span className="ml-1 text-text-muted dark:text-text-muted-dark font-normal text-xs">
                      — drag to canvas
                    </span>
                  </h3>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted dark:text-text-muted-dark" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      aria-label="Filter nodes"
                      onKeyDown={(e) => {
                        if (shouldClearNodeFilter({ key: e.key })) {
                          setSearchQuery((currentValue) =>
                            getNextNodeFilterValue({
                              currentValue,
                              key: e.key,
                            }),
                          );
                        }
                      }}
                      placeholder="Filter nodes…"
                      className="w-full pl-8 pr-8 py-1.5 text-sm rounded-sm border border-border dark:border-border-dark bg-surface dark:bg-surface-dark text-text-primary dark:text-text-primary-dark placeholder:text-text-muted dark:placeholder:text-text-muted-dark focus:outline-none focus:ring-2 focus:ring-primary"
                    />

                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery((currentValue) =>
                            getNextNodeFilterValue({
                              currentValue,
                              clearRequested: true,
                            }),
                          );
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-sm text-text-muted dark:text-text-muted-dark hover:text-text-primary dark:hover:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors motion-reduce:transition-none"
                        aria-label="Clear node filter"
                        title="Clear filter"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto">
                  {filteredSections.length === 0 ? (
                    <div className="p-4 text-center text-sm text-text-muted dark:text-text-muted-dark">
                      No nodes match &quot;{searchQuery}&quot;
                    </div>
                  ) : (
                    filteredSections.map((section) => (
                      <NodeSection
                        key={section.key}
                        title={section.title}
                        icon={section.icon}
                        nodes={section.nodes}
                        onDragStart={(e, node) => {
                          onDragStart(e, node);
                          setTimeout(() => close(), 100);
                        }}
                        onRenamePreset={renamePreset}
                        onDeletePreset={deletePreset}
                        defaultOpen={!searchQuery}
                      />
                    ))
                  )}
                </div>
              </Popover.Panel>
            </Transition>
          </>
        )}
      </Popover>
    </div>
  );
}

interface NodeSectionProps {
  title: string;
  icon: LucideIcon;
  nodes: NodeTemplate[];
  onDragStart: (event: DragEvent, node: NodeTemplate) => void;
  onRenamePreset?: (presetId: string, name: string, previous: string) => void;
  onDeletePreset?: (presetId: string, name: string) => void;
  defaultOpen: boolean;
}

function NodeSection({
  title,
  icon: Icon,
  nodes,
  onDragStart,
  onRenamePreset,
  onDeletePreset,
  defaultOpen,
}: NodeSectionProps) {
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const commitRename = (presetId: string, previous: string) => {
    const trimmed = draftName.trim();
    setEditingPresetId(null);
    if (!trimmed || trimmed === previous) return;
    onRenamePreset?.(presetId, trimmed, previous);
  };

  return (
    <div className="collapse collapse-arrow rounded-none border-b border-border dark:border-border-dark last:border-b-0">
      <input
        type="checkbox"
        defaultChecked={defaultOpen}
        aria-label={`Toggle ${title}`}
      />
      <div className="collapse-title text-sm font-medium py-2 min-h-0 flex items-center gap-2 text-text-primary dark:text-text-primary-dark">
        <Icon className="w-4 h-4 text-text-secondary dark:text-text-secondary-dark flex-shrink-0" />
        <span>{title}</span>
        <span className="ml-auto rounded-full border border-border dark:border-border-dark px-1.5 py-0.5 text-[9px] font-mono text-text-muted dark:text-text-muted-dark">
          {nodes.length}
        </span>
      </div>
      <div className="collapse-content px-2 pb-1">
        <div className="space-y-0.5">
          {nodes.map((node) => (
            <div
              key={node.presetId ?? `${node.type}-${node.label}`}
              draggable={node.presetId !== editingPresetId}
              onDragStart={(e) => onDragStart(e, node)}
              className="group flex flex-col gap-0.5 px-2.5 py-1.5 rounded-sm cursor-grab border border-transparent hover:border-border dark:hover:border-border-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay active:cursor-grabbing transition-colors motion-reduce:transition-none"
              title={`Drag ${node.label} to canvas`}
            >
              <div className="flex items-center gap-1.5 text-sm text-text-primary dark:text-text-primary-dark">
                {node.method && (
                  <span
                    className={`inline-block px-1.5 py-0.5 text-[10px] font-mono border rounded-sm ${methodBadge[node.method] ?? "text-primary bg-primary/10 border-primary/30"}`}
                  >
                    {node.method}
                  </span>
                )}
                {node.presetId === editingPresetId ? (
                  <input
                    // The row turns into this input on an explicit rename
                    // click, so focus has to follow it — otherwise the field is
                    // unreachable by keyboard.
                    autoFocus
                    type="text"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      // Escape must not bubble: the palette lives in a Popover
                      // that closes on Escape, which would unmount the row
                      // mid-edit.
                      e.stopPropagation();
                      if (e.key === "Enter") {
                        commitRename(node.presetId!, node.label);
                      } else if (e.key === "Escape") {
                        setEditingPresetId(null);
                      }
                    }}
                    // Blur cancels rather than saves: the popover closes on any
                    // outside click, so a save-on-blur would write on teardown.
                    onBlur={() => setEditingPresetId(null)}
                    aria-label={`New name for ${node.label}`}
                    className="min-w-0 flex-1 rounded-sm border border-border bg-surface-raised px-1.5 py-0.5 text-sm text-text-primary transition-[border-color,outline] duration-[var(--aw-transition-fast)] focus:border-primary focus:outline-none focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] motion-reduce:transition-none dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark dark:focus:border-primary-light"
                  />
                ) : (
                  <span className="font-medium truncate">{node.label}</span>
                )}
                {node.presetId && node.presetId !== editingPresetId && (
                  <span className="ml-auto flex flex-shrink-0 items-center gap-0.5">
                    {onRenamePreset && (
                      <button
                        type="button"
                        onClick={() => {
                          setDraftName(node.label);
                          setEditingPresetId(node.presetId!);
                        }}
                        className="rounded-sm p-0.5 text-text-muted opacity-0 transition-colors hover:bg-surface-overlay hover:text-text-primary focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] group-hover:opacity-100 motion-reduce:transition-none dark:text-text-muted-dark dark:hover:bg-surface-dark-overlay dark:hover:text-text-primary-dark"
                        title={`Rename preset "${node.label}"`}
                        aria-label={`Rename preset ${node.label}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {onDeletePreset && (
                      <button
                        type="button"
                        onClick={() => onDeletePreset(node.presetId!, node.label)}
                        className="rounded-sm p-0.5 text-text-muted opacity-0 transition-colors hover:bg-status-error/10 hover:text-status-error focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] group-hover:opacity-100 motion-reduce:transition-none dark:text-text-muted-dark"
                        title={`Delete preset "${node.label}"`}
                        aria-label={`Delete preset ${node.label}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </span>
                )}
              </div>
              {node.description && (
                <span className="text-xs text-text-muted dark:text-text-muted-dark truncate">
                  {node.description}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
