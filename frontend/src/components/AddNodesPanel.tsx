import { useState, useMemo, type DragEvent } from "react";
import { Popover, Transition } from "@headlessui/react";
import {
  X,
  Plus,
  PanelRightOpen,
  Search,
  Globe,
  GitBranch,
  CheckCircle,
  Package,
  type LucideIcon,
} from "lucide-react";
import { usePalette } from "../contexts/PaletteContext";
import {
  getNextNodeFilterValue,
  shouldClearNodeFilter,
} from "../utils/nodeFilterBehavior";
import type { AddNodesPanelProps } from "../types";

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
  workflowId?: string;
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
  workflowId?: string;
  template?: Record<string, unknown>;
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
}: AddNodesPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const { importedGroups } = usePalette();

  const allSections = useMemo<NodeSection[]>(() => {
    const sections: NodeSection[] = nodeTemplates.map((cat) => ({
      key: cat.category,
      title: cat.category,
      icon: sectionIcons[cat.category] ?? Package,
      nodes: cat.nodes as NodeTemplate[],
    }));

    importedGroups.forEach((group: ImportedGroup) => {
      const items = (group.items ?? []) as PaletteItem[];
      const importedNodes: NodeTemplate[] = items.map((item) =>
        item.method === "WORKFLOW"
          ? {
              type: "workflow",
              label: item.label ?? "Workflow",
              description: "Sub-workflow",
              method: "WORKFLOW",
              workflowId: item.workflowId,
              template: {
                type: "workflow",
                label: item.label ?? "Workflow",
                config: {
                  workflowId: item.workflowId,
                  workflowName: item.label,
                },
              },
            }
          : {
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
            },
      ) as NodeTemplate[];
      sections.push({
        key: `imported-${group.id}`,
        title: group.title,
        icon: Package,
        nodes: importedNodes,
      });
    });

    return sections;
  }, [importedGroups]);

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
    if (node.method && node.method !== "WORKFLOW") {
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
      className={`fixed bottom-20 right-5 sm:right-6 z-[9999] flex flex-col gap-2.5 ${
        isModalOpen ? "opacity-0 pointer-events-none" : "opacity-100"
      } transition-opacity duration-200 motion-reduce:transition-none`}
    >
      {!showVariablesPanel && (
        <button
          type="button"
          onClick={() => onShowVariablesPanel(true)}
          className="flex items-center justify-center w-11 h-11 rounded-sm bg-surface-raised dark:bg-surface-dark-raised text-primary dark:text-primary-light border border-border dark:border-border-dark shadow-node hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors motion-reduce:transition-none"
          title="Show Side Panel (Variables, Functions, Settings)"
          aria-label="Show panel"
        >
          <PanelRightOpen className="w-5 h-5" />
        </button>
      )}

      {/* impeccable-variants-start fe31a30d */}
      <div
        data-impeccable-variants="fe31a30d"
        data-impeccable-variant-count="3"
        style={{ display: "contents" }}
      >
        {/* Variants: insert below this line */}
        <style data-impeccable-css="fe31a30d">{`
          @scope ([data-impeccable-variant="1"]) {
            :scope > .insert-label {
              writing-mode: vertical-rl;
              text-orientation: mixed;
              font-size: 0.75rem;
              line-height: 1;
              letter-spacing: 0.04em;
              padding: 8px 4px;
              border: 1px solid var(--aw-border);
              background: var(--aw-surface-raised);
              color: var(--aw-text-secondary);
              border-radius: 2px;
              transition: color 150ms ease-in-out, background 150ms ease-in-out;
              cursor: default;
              user-select: none;
            }
            :scope > .insert-label:hover {
              color: var(--aw-primary);
              background: var(--aw-surface-overlay);
            }
          }
          @scope ([data-impeccable-variant="2"]) {
            :scope > .insert-stack {
              display: flex;
              flex-direction: column;
              gap: 12px;
              align-items: center;
              justify-content: center;
              padding: 16px 6px;
              border: 1px solid var(--aw-border);
              background: var(--aw-surface-raised);
              border-radius: 2px;
              transition: border-color 150ms ease-in-out;
            }
            :scope > .insert-stack:hover {
              border-color: var(--aw-primary);
            }
            :scope > .insert-stack > .bar {
              height: 3px;
              background: var(--aw-text-muted);
              border-radius: 1px;
              transition: background 150ms ease-in-out;
            }
            :scope > .insert-stack:hover > .bar {
              background: var(--aw-primary);
            }
            :scope > .insert-stack > .bar:nth-child(1) { width: 24px; }
            :scope > .insert-stack > .bar:nth-child(2) { width: 18px; }
            :scope > .insert-stack > .bar:nth-child(3) { width: 12px; }
          }
          @scope ([data-impeccable-variant="3"]) {
            :scope > .insert-line {
              position: relative;
              width: 2px;
              height: 80px;
              margin: 0 auto;
              background: var(--aw-primary);
              border-radius: 1px;
              transition: height 200ms ease-in-out;
            }
            :scope > .insert-line:hover {
              height: 100px;
            }
            :scope > .insert-line::before {
              content: "";
              position: absolute;
              top: -4px;
              left: -2px;
              width: 6px;
              height: 6px;
              border-radius: 50%;
              background: var(--aw-primary);
            }
          }
        `}</style>
        <div data-impeccable-variant="1">
          <div className="insert-label">Add Node</div>
        </div>
        <div data-impeccable-variant="2" style={{ display: "none" }}>
          <div className="insert-stack">
            <div className="bar" />
            <div className="bar" />
            <div className="bar" />
          </div>
        </div>
        <div data-impeccable-variant="3" style={{ display: "none" }}>
          <div className="insert-line" />
        </div>
      </div>
      {/* impeccable-variants-end fe31a30d */}

      <Popover className="relative">
        {({ open, close }) => (
          <>
            <Popover.Button
              disabled={isModalOpen}
              className="flex items-center justify-center w-11 h-11 rounded-sm border border-primary bg-primary dark:bg-primary-light text-surface-raised dark:text-surface-dark-raised shadow-node hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors motion-reduce:transition-none"
              aria-label={open ? "Close node palette" : "Add nodes"}
            >
              {open ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
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
              <Popover.Panel className="absolute bottom-full mb-2 right-0 w-72 max-h-[60vh] flex flex-col rounded-sm bg-surface-raised dark:bg-surface-dark-raised shadow-node border border-border dark:border-border-dark overflow-hidden">
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

                <div className="flex-1 overflow-y-auto">
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
  defaultOpen: boolean;
}

function NodeSection({
  title,
  icon: Icon,
  nodes,
  onDragStart,
  defaultOpen,
}: NodeSectionProps) {
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
              key={`${node.type}-${node.label}`}
              draggable
              onDragStart={(e) => onDragStart(e, node)}
              className="group flex flex-col gap-0.5 px-2.5 py-1.5 rounded-sm cursor-grab border border-transparent hover:border-border dark:hover:border-border-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay active:cursor-grabbing transition-colors motion-reduce:transition-none"
              title={`Drag ${node.label} to canvas`}
            >
              <div className="flex items-center gap-1.5 text-sm text-text-primary dark:text-text-primary-dark">
                {node.method && node.method !== "WORKFLOW" && (
                  <span
                    className={`inline-block px-1.5 py-0.5 text-[10px] font-mono border rounded-sm ${methodBadge[node.method] ?? "text-primary bg-primary/10 border-primary/30"}`}
                  >
                    {node.method}
                  </span>
                )}
                {node.method === "WORKFLOW" && (
                  <span className="inline-block px-1.5 py-0.5 text-[10px] font-mono text-text-secondary dark:text-text-secondary-dark bg-surface-overlay dark:bg-surface-dark-overlay border border-border dark:border-border-dark rounded-sm">
                    WF
                  </span>
                )}
                <span className="font-medium truncate">{node.label}</span>
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
