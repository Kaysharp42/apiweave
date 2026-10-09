import { useEffect, useMemo, useRef, useState } from "react";
import { Combobox, Dialog, DialogPanel } from "@headlessui/react";
import { Command, Search, Waypoints, Workflow as WorkflowIcon } from "lucide-react";
import { toast } from "sonner";
import { Input } from "../atoms/Input";
import { HighlightedText } from "../atoms/HighlightedText";
import { apiweave } from "../../utils/apiweaveClient";
import useCanvasStore from "../../stores/CanvasStore";
import useTabStore from "../../stores/TabStore";
import type {
  CanvasCommand,
  CommandPaletteItem,
  CommandPaletteProps,
} from "../../types";

/** Below this many characters only commands are filtered: one letter matches most of a workspace. */
const SEARCH_MIN_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 200;
const WORKFLOW_RESULT_LIMIT = 5;
const NODE_RESULT_LIMIT = 10;

function matchesQuery(command: CanvasCommand, query: string): boolean {
  const haystack = [command.title, command.group, ...command.keywords]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase().trim());
}

function itemKey(item: CommandPaletteItem): string {
  if (item.kind === "command") return `command:${item.command.id}`;
  if (item.kind === "workflow") return `workflow:${item.workflow.workflowId}`;
  return `node:${item.node.workflowId}:${item.node.nodeId}`;
}

/** Activate the workflow's tab, opening it first when it is not open. */
async function showWorkflow(workspaceId: string, workflowId: string): Promise<void> {
  const tabs = useTabStore.getState();
  const open = tabs.tabs.find((tab) => tab.workflowId === workflowId);
  if (open) {
    tabs.setActive(open.id);
    return;
  }
  tabs.openTab(await apiweave.workflows.get(workspaceId, workflowId));
}

const optionClass =
  "group flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2 text-sm text-text-primary data-[focus]:bg-surface-overlay dark:text-text-primary-dark dark:data-[focus]:bg-surface-dark-overlay";
const iconClass =
  "h-4 w-4 flex-shrink-0 text-primary dark:text-primary-light";
const asideClass =
  "max-w-[45%] flex-shrink-0 truncate text-xs text-text-muted dark:text-text-muted-dark";

export function CommandPalette({
  open,
  commands,
  workspaceId,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<readonly CommandPaletteItem[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const availableCommands = useMemo(
    () => commands.filter((command) => command.when()),
    [commands],
  );
  const filteredCommands = useMemo(
    () => availableCommands.filter((command) => matchesQuery(command, query)),
    [availableCommands, query],
  );
  const items = useMemo<readonly CommandPaletteItem[]>(
    () => [
      ...filteredCommands.map((command) => ({ kind: "command" as const, command })),
      ...found,
    ],
    [filteredCommands, found],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Debounced workspace search; a newer keystroke discards an older answer.
  useEffect(() => {
    const term = query.trim();
    if (!open || !workspaceId || term.length < SEARCH_MIN_LENGTH) {
      setFound([]);
      setSearching(false);
      return;
    }
    let stale = false;
    setSearching(true);
    const timer = setTimeout(() => {
      Promise.all([
        apiweave.workflows.search(workspaceId, term, WORKFLOW_RESULT_LIMIT),
        apiweave.workflows.searchWorkspaceNodes(workspaceId, term, NODE_RESULT_LIMIT),
      ])
        .then(([workflows, nodes]) => {
          if (stale) return;
          setFound([
            ...workflows.items.map((workflow) => ({ kind: "workflow" as const, workflow })),
            ...nodes.items.map((node) => ({ kind: "node" as const, node })),
          ]);
        })
        .catch(() => {
          if (!stale) setFound([]);
        })
        .finally(() => {
          if (!stale) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [open, query, workspaceId]);

  const selectItem = (item: CommandPaletteItem | null) => {
    if (!item) return;
    if (item.kind === "command") {
      item.command.run();
      onClose();
      return;
    }
    onClose();
    if (!workspaceId) return;
    const workflowId =
      item.kind === "workflow" ? item.workflow.workflowId : item.node.workflowId;
    // Parked before the tab switch: the target canvas mounts and reads it.
    if (item.kind === "node") {
      useCanvasStore.getState().focusNode(workflowId, item.node.nodeId);
    }
    showWorkflow(workspaceId, workflowId).catch(() => {
      useCanvasStore.getState().clearPendingFocus();
      toast.error("That workflow could not be opened.");
    });
  };

  const term = query.trim();

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div
        className="fixed inset-0 bg-text-primary/40 dark:bg-surface-dark/80"
        aria-hidden="true"
      />
      <div className="fixed inset-0 flex items-start justify-center p-4 pt-[12vh]">
        <DialogPanel className="w-full max-w-xl overflow-hidden rounded-sm border border-border bg-surface-raised shadow-popover dark:border-border-dark dark:bg-surface-dark-raised">
          <Combobox<CommandPaletteItem | null> onChange={selectItem}>
            <div className="relative border-b border-border p-3 dark:border-border-dark">
              <Search
                className="pointer-events-none absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted dark:text-text-muted-dark"
                aria-hidden="true"
              />
              <Combobox.Input
                as={Input}
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={
                  workspaceId
                    ? "Search commands, workflows and nodes..."
                    : "Search commands..."
                }
                aria-label="Search commands, workflows and nodes"
                size="lg"
                className="pl-9"
              />
            </div>
            <Combobox.Options
              static
              className="max-h-[56vh] overflow-y-auto p-2 empty:hidden"
            >
              {items.map((item) => (
                <Combobox.Option
                  key={itemKey(item)}
                  value={item}
                  className={optionClass}
                >
                  {item.kind === "command" && (
                    <>
                      <Command className={iconClass} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">
                        {item.command.title}
                      </span>
                      <span className={asideClass}>
                        {item.command.shortcut ?? item.command.group}
                      </span>
                    </>
                  )}
                  {item.kind === "workflow" && (
                    <>
                      <WorkflowIcon className={iconClass} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">
                        <HighlightedText text={item.workflow.name} query={term} />
                      </span>
                      <span className={asideClass}>Workflow</span>
                    </>
                  )}
                  {item.kind === "node" && (
                    <>
                      <Waypoints className={iconClass} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          <HighlightedText
                            text={item.node.label ?? item.node.nodeId}
                            query={term}
                          />
                        </span>
                        {item.node.urlPath !== null && (
                          <span className="block truncate font-mono text-xs text-text-muted dark:text-text-muted-dark">
                            {item.node.method !== null && (
                              <>
                                <HighlightedText text={item.node.method} query={term} />{" "}
                              </>
                            )}
                            <HighlightedText text={item.node.urlPath} query={term} />
                          </span>
                        )}
                      </span>
                      <span className={asideClass}>{item.node.workflowName}</span>
                    </>
                  )}
                </Combobox.Option>
              ))}
            </Combobox.Options>
            {items.length === 0 && (
              <p
                role="status"
                className="px-5 py-8 text-center text-sm text-text-muted dark:text-text-muted-dark"
              >
                {searching ? "Searching..." : `Nothing matches “${query}”.`}
              </p>
            )}
          </Combobox>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
