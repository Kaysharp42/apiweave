import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import {
  ChevronDown,
  GitBranch,
  HardDrive,
  Plus,
  UserRound,
} from "lucide-react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useWorkspaceGitStatuses } from "../../hooks/useWorkspaceGitStatuses";
import { Button } from "../atoms/Button";
import { Tooltip } from "../atoms/Tooltip";
import { GitSyncKindIcon } from "../molecules/GitSyncKindIcon";
import { CreateWorkspaceModal } from "./CreateWorkspaceModal";
import { OpenWorkspaceFromGitModal } from "./OpenWorkspaceFromGitModal";
import { describeGitSync, GIT_SYNC_INTENT_TEXT } from "../../utils/gitSync";
import type { Workspace, WorkspaceItemProps } from "../../types";

/**
 * The current workspace's name and source. Split out of the switcher button so
 * the open/close chevron logic isn't sharing a render-prop arrow with this
 * branching.
 */
function WorkspaceSwitcherLabel({
  label,
  source,
}: {
  label: string;
  source: string;
}) {
  return (
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-1 text-xs font-medium text-text-primary dark:text-text-primary-dark">
        <span className="truncate">{label}</span>
      </span>
      <span className="block truncate text-xxs text-text-muted dark:text-text-muted-dark">
        {source}
      </span>
    </span>
  );
}

/**
 * Workspace scope selector. Lives at the top of the sidebar panel — directly
 * above the list it scopes — so the current workspace reads as the heading for
 * everything below it.
 *
 * The panel is anchored, which makes Headless UI portal it. That matters: the
 * sidebar sits inside Allotment's overflow-hidden panes, so an absolutely
 * positioned dropdown would be clipped at the pane edge.
 */
export function OrgWorkspaceSwitcher() {
  const {
    availableWorkspaces,
    currentWorkspace,
    refresh,
    switchTo,
    isLoading,
  } = useWorkspace();
  const [createWsOpen, setCreateWsOpen] = useState(false);
  const [openFromGitOpen, setOpenFromGitOpen] = useState(false);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const gitStatuses = useWorkspaceGitStatuses();

  const handleSelect = (workspace: Workspace, close: () => void) => {
    switchTo(workspace.slug);
    close();
  };

  const handleWorkspaceCreated = async (
    workspace: Workspace,
  ): Promise<void> => {
    await refresh();
    switchTo(workspace.slug);
  };

  const handleItemKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      menuItemRefs.current[index + 1]?.focus();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      menuItemRefs.current[index - 1]?.focus();
    }
  };

  if (isLoading) {
    return (
      <div className="flex w-full items-center gap-2 rounded border border-border px-2 py-1.5 dark:border-border-dark">
        <div className="h-6 w-6 flex-shrink-0 animate-pulse rounded bg-border/40 dark:bg-border-dark/40" />
        <div className="h-3 w-24 animate-pulse rounded bg-border/40 dark:bg-border-dark/40" />
      </div>
    );
  }

  const personalWorkspace = availableWorkspaces.find((ws) => ws.isPersonal);
  const otherWorkspaces = availableWorkspaces.filter((ws) => !ws.isPersonal);

  const flatList: Workspace[] = [];
  if (personalWorkspace) flatList.push(personalWorkspace);
  flatList.push(...otherWorkspaces);

  const displayLabel = currentWorkspace?.name ?? "Personal";
  const displaySource = currentWorkspace
    ? workspaceSource(currentWorkspace)
    : "Personal workspace";

  return (
    <>
      <Popover>
        {({ open, close }) => (
          <>
            <PopoverButton
              className={[
                "group flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left",
                "transition-colors duration-150 motion-reduce:transition-none cursor-pointer",
                "focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 dark:focus-visible:outline-primary-light",
                open
                  ? "border-primary/40 bg-primary/5 dark:border-primary-light/40 dark:bg-primary-light/5"
                  : "border-border bg-surface hover:border-border hover:bg-surface-overlay dark:border-border-dark dark:bg-surface-dark dark:hover:bg-surface-dark-overlay",
              ].join(" ")}
              aria-label="Switch workspace"
              aria-haspopup="listbox"
            >
              <span
                className={[
                  "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded",
                  "bg-primary/10 text-primary dark:bg-primary-light/10 dark:text-primary-light",
                ].join(" ")}
              >
                {sourceIcon(displaySource, "h-3.5 w-3.5")}
              </span>

              <WorkspaceSwitcherLabel
                label={displayLabel}
                source={displaySource}
              />

              <ChevronDown
                className={[
                  "h-3.5 w-3.5 flex-shrink-0 text-text-muted transition-transform duration-150 motion-reduce:transition-none dark:text-text-muted-dark",
                  open ? "rotate-180" : "",
                ].join(" ")}
                aria-hidden="true"
              />
            </PopoverButton>

            <PopoverPanel
              anchor={{ to: "bottom start", gap: 4, padding: 8 }}
              className="z-50 w-64 min-w-[var(--button-width)] overflow-hidden rounded border border-border bg-surface-raised shadow-overlay focus:outline-none dark:border-border-dark dark:bg-surface-dark-raised"
            >
              <div className="border-b border-border/80 px-3 py-2 dark:border-border-dark/80">
                <span className="text-xxs font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark">
                  Switch workspace
                </span>
              </div>

              <div
                className="max-h-72 overflow-y-auto py-1"
                role="listbox"
                aria-label="Workspaces"
              >
                {flatList.map((workspace, index) => {
                  const source = workspaceSource(workspace);
                  return (
                    <WorkspaceItem
                      key={workspace.workspaceId}
                      workspace={workspace}
                      index={index}
                      isActive={
                        currentWorkspace?.workspaceId === workspace.workspaceId
                      }
                      icon={sourceIcon(source, "h-4 w-4")}
                      source={source}
                      syncStatus={gitStatuses.get(workspace.workspaceId) ?? null}
                      onSelect={(selected) => handleSelect(selected, close)}
                      onKeyDown={handleItemKeyDown}
                      itemRef={(el) => {
                        menuItemRefs.current[index] = el;
                      }}
                    />
                  );
                })}

                {flatList.length === 0 && (
                  <div className="px-3 py-6 text-center text-xs text-text-muted dark:text-text-muted-dark">
                    No workspaces available
                  </div>
                )}
              </div>

              <div className="space-y-1 border-t border-border/80 p-2 dark:border-border-dark/80">
                <Button
                  variant="ghost"
                  size="sm"
                  fullWidth
                  className="justify-start text-xs"
                  icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => {
                    close();
                    setCreateWsOpen(true);
                  }}
                >
                  New workspace
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  fullWidth
                  className="justify-start text-xs"
                  icon={<GitBranch className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => {
                    close();
                    setOpenFromGitOpen(true);
                  }}
                >
                  Open from git…
                </Button>
              </div>
            </PopoverPanel>
          </>
        )}
      </Popover>

      <CreateWorkspaceModal
        isOpen={createWsOpen}
        onClose={() => setCreateWsOpen(false)}
        onCreated={handleWorkspaceCreated}
      />

      <OpenWorkspaceFromGitModal
        isOpen={openFromGitOpen}
        onClose={() => setOpenFromGitOpen(false)}
      />
    </>
  );
}

// fallow-ignore-next-line code-duplication
function WorkspaceItem({
  workspace,
  index,
  isActive,
  icon,
  source,
  syncStatus,
  onSelect,
  onKeyDown,
  itemRef,
}: WorkspaceItemProps) {
  const indicator = syncStatus === null ? null : describeGitSync(syncStatus);
  return (
    <button
      ref={itemRef}
      type="button"
      role="option"
      aria-selected={isActive}
      onClick={() => onSelect(workspace)}
      onKeyDown={(e) => onKeyDown(e, index)}
      className={`flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors duration-200 motion-reduce:transition-none focus:outline-none ${
        isActive
          ? "bg-primary/10 text-primary dark:bg-primary-light/10 dark:text-primary-light"
          : "text-text-primary hover:bg-surface-overlay dark:text-text-primary-dark dark:hover:bg-surface-dark-overlay"
      }`}
    >
      <span
        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border ${
          isActive
            ? "bg-primary/15 text-primary dark:bg-primary-light/15 dark:text-primary-light"
            : "bg-border/30 text-text-secondary dark:bg-border-dark/30 dark:text-text-secondary-dark"
        }`}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-sm font-medium">
          <span className="truncate">{workspace.name}</span>
        </div>
        <div className="truncate text-xs text-text-muted dark:text-text-muted-dark">
          {source}
        </div>
      </div>
      {indicator !== null && indicator.icon !== null && (
        <Tooltip content={indicator.label}>
          <span
            role="img"
            aria-label={indicator.label}
            className={`flex flex-shrink-0 items-center ${GIT_SYNC_INTENT_TEXT[indicator.intent]}`}
          >
            <GitSyncKindIcon indicator={indicator} className="h-3.5 w-3.5" />
          </span>
        </Tooltip>
      )}
      {isActive && (
        <span className="flex h-2 w-2 flex-shrink-0 rounded-full bg-primary dark:bg-primary-light" />
      )}
    </button>
  );
}

/** One icon vocabulary for the trigger and the list, so they read as the same thing. */
function sourceIcon(source: string, className: string): React.ReactNode {
  if (source === "On this device")
    return <HardDrive className={`${className} flex-shrink-0`} />;
  return <UserRound className={`${className} flex-shrink-0`} />;
}

/** Where a workspace lives, in the switcher's own vocabulary. */
function workspaceSource(workspace: Workspace): string {
  if (workspace.isPersonal) return "Personal workspace";
  return "On this device";
}
