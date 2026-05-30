import { useState, useMemo, type DragEvent } from 'react';
import { Popover, Transition } from '@headlessui/react';
import { X, Plus, PanelRightOpen, Search, Globe, GitBranch, CheckCircle, Package, type LucideIcon } from 'lucide-react';
import { usePalette } from '../contexts/PaletteContext';
import { getNextNodeFilterValue, shouldClearNodeFilter } from '../utils/nodeFilterBehavior';

const methodBadge: Record<string, string> = {
  GET: 'bg-method-get',
  POST: 'bg-method-post',
  PUT: 'bg-method-put',
  DELETE: 'bg-method-delete',
  PATCH: 'bg-method-patch',
};

const sectionIcons: Record<string, LucideIcon> = {
  'HTTP Requests': Globe,
  'Control Flow': GitBranch,
  'Validation': CheckCircle,
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
    category: 'HTTP Requests',
    nodes: [
      { type: 'http-request', label: 'GET Request', description: 'Make a GET request', method: 'GET' },
      { type: 'http-request', label: 'POST Request', description: 'Make a POST request', method: 'POST' },
      { type: 'http-request', label: 'PUT Request', description: 'Make a PUT request', method: 'PUT' },
      { type: 'http-request', label: 'DELETE Request', description: 'Make a DELETE request', method: 'DELETE' },
      { type: 'http-request', label: 'PATCH Request', description: 'Make a PATCH request', method: 'PATCH' },
    ],
  },
  {
    category: 'Control Flow',
    nodes: [
      { type: 'delay', label: 'Delay', description: 'Add a delay before next step' },
      { type: 'merge', label: 'Merge', description: 'Merge parallel branches' },
      { type: 'end', label: 'End', description: 'Mark the end of workflow' },
    ],
  },
  {
    category: 'Validation',
    nodes: [
      { type: 'assertion', label: 'Assertion', description: 'Assert on conditional expressions' },
    ],
  },
];

export interface AddNodesPanelProps {
  isModalOpen?: boolean;
  showVariablesPanel?: boolean;
  onShowVariablesPanel?: (show: boolean) => void;
}

export default function AddNodesPanel({
  isModalOpen = false,
  showVariablesPanel = false,
  onShowVariablesPanel = () => {},
}: AddNodesPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
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
          item.method === 'WORKFLOW'
            ? {
                type: 'workflow',
                label: item.label ?? 'Workflow',
                description: 'Sub-workflow',
                method: 'WORKFLOW',
                workflowId: item.workflowId,
                template: {
                  type: 'workflow',
                  label: item.label ?? 'Workflow',
                  config: { workflowId: item.workflowId, workflowName: item.label },
                },
              }
            : {
                type: 'http-request',
                label: item.label ?? item.url ?? 'Request',
                description: item.url ?? '',
                method: item.method ?? 'GET',
                template: {
                  type: 'http-request',
                  label: item.label ?? item.url ?? 'Request',
                  config: {
                    method: item.method ?? 'GET',
                    url: item.url ?? '',
                    queryParams: item.queryParams ?? '',
                    pathVariables: item.pathVariables ?? '',
                    headers: item.headers ?? '',
                    cookies: item.cookies ?? '',
                    body: item.body ?? '',
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
    event.dataTransfer.setData('application/reactflow', node.type);
    if (node.method && node.method !== 'WORKFLOW') {
      event.dataTransfer.setData('application/reactflow-method', node.method);
    }
    if (node.template) {
      try {
        event.dataTransfer.setData('application/reactflow-node-template', JSON.stringify(node.template));
      } catch {
        // Ignore serialization errors
      }
    }
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      className={`fixed bottom-20 right-5 sm:right-6 z-[9999] flex flex-col gap-2.5 ${
        isModalOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'
      } transition-opacity duration-200`}
    >
      {!showVariablesPanel && (
        <button
          type="button"
          onClick={() => onShowVariablesPanel(true)}
          className="flex items-center justify-center w-11 h-11 rounded-full bg-primary text-white shadow-lg ring-1 ring-primary/40 hover:brightness-110 transition-all"
          title="Show Side Panel (Variables, Functions, Settings)"
          aria-label="Show panel"
        >
          <PanelRightOpen className="w-5 h-5" />
        </button>
      )}

      <Popover className="relative">
        {({ open, close }) => (
          <>
            <Popover.Button
              disabled={isModalOpen}
              className="flex items-center justify-center w-11 h-11 rounded-full border-2 border-primary bg-primary text-white shadow-xl hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              aria-label={open ? 'Close node palette' : 'Add nodes'}
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
                  getNextNodeFilterValue({ currentValue, isPaletteClosing: true }),
                );
              }}
            >
              <Popover.Panel className="absolute bottom-full mb-2 right-0 w-72 max-h-[60vh] flex flex-col rounded-xl bg-surface-raised dark:bg-surface-dark-raised shadow-2xl border border-border-default dark:border-border-default-dark overflow-hidden">
                <div className="p-3 border-b border-border-default dark:border-border-default-dark">
                  <h3 className="text-sm font-bold text-primary dark:text-primary-dark mb-2">
                    Add Nodes
                    <span className="ml-1 text-text-muted dark:text-text-muted-dark font-normal text-xs"> -- drag to canvas</span>
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
                            getNextNodeFilterValue({ currentValue, key: e.key }),
                          );
                        }
                      }}
                      placeholder="Filter nodes…"
                      className="w-full pl-8 pr-8 py-1.5 text-sm rounded-lg border border-border-default dark:border-border-default-dark bg-surface dark:bg-surface-dark text-text-primary dark:text-text-primary-dark placeholder:text-text-muted dark:placeholder:text-text-muted-dark focus:outline-none focus:ring-1 focus:ring-primary dark:focus:ring-primary-dark"
                    />

                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery((currentValue) =>
                            getNextNodeFilterValue({ currentValue, clearRequested: true }),
                          );
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-text-muted dark:text-text-muted-dark hover:text-text-primary dark:hover:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors"
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

function NodeSection({ title, icon: Icon, nodes, onDragStart, defaultOpen }: NodeSectionProps) {
  return (
    <div className="collapse collapse-arrow rounded-none border-b border-border-default dark:border-border-default-dark last:border-b-0">
      <input type="checkbox" defaultChecked={defaultOpen} aria-label={`Toggle ${title}`} />
      <div className="collapse-title text-sm font-medium py-2 min-h-0 flex items-center gap-2 text-text-primary dark:text-text-primary-dark">
        <Icon className="w-4 h-4 text-text-secondary dark:text-text-secondary-dark flex-shrink-0" />
        <span>{title}</span>
        <span className="badge badge-xs badge-ghost ml-auto">{nodes.length}</span>
      </div>
      <div className="collapse-content px-2 pb-1">
        <div className="space-y-0.5">
          {nodes.map((node) => (
            <div
              key={`${node.type}-${node.label}`}
              draggable
              onDragStart={(e) => onDragStart(e, node)}
              className="group flex flex-col gap-0.5 px-2.5 py-1.5 rounded-md cursor-grab hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay active:cursor-grabbing transition-colors"
              title={`Drag ${node.label} to canvas`}
            >
              <div className="flex items-center gap-1.5 text-sm text-text-primary dark:text-text-primary-dark">
                {node.method && node.method !== 'WORKFLOW' && (
                  <span className={`inline-block px-1.5 py-px text-[10px] font-bold text-white rounded ${methodBadge[node.method] ?? 'bg-primary'}`}>
                    {node.method}
                  </span>
                )}
                {node.method === 'WORKFLOW' && (
                  <span className="inline-block px-1.5 py-px text-[10px] font-bold text-white bg-purple-600 rounded">
                    WF
                  </span>
                )}
                <span className="font-medium truncate">{node.label}</span>
              </div>
              {node.description && (
                <span className="text-xs text-text-muted dark:text-text-muted-dark truncate">{node.description}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
