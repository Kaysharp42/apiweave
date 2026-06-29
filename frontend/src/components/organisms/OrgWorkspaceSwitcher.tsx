import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ChevronDown, Building2, User, Plus, ListTree } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useAuth } from "../../auth/useAuth";
import { Button } from "../atoms/Button";
import type { WorkspaceEntry } from "../../types/WorkspaceContextValue";
import { CreateOrganizationModal } from "./CreateOrganizationModal";
import { CreateWorkspaceModal } from "./CreateWorkspaceModal";
import { useBillingConfig } from "../../hooks/useBillingConfig";
import type { Organization, Workspace } from "../../types";

export function OrgWorkspaceSwitcher() {
  const {
    availableWorkspaces,
    currentOrg,
    currentWorkspace,
    refresh,
    switchTo,
    isLoading,
  } = useWorkspace();
  const { isSingleUser } = useAuth();
  const billing = useBillingConfig();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [createOrgOpen, setCreateOrgOpen] = useState(false);
  const [createWsOpen, setCreateWsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return undefined;

    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener(
      "touchstart",
      handleOutsideClick as EventListener,
      { passive: true },
    );
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener(
        "touchstart",
        handleOutsideClick as EventListener,
      );
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const handleTriggerKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (
      event.key === "Enter" ||
      event.key === " " ||
      event.key === "ArrowDown"
    ) {
      event.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => menuItemRefs.current[0]?.focus());
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  const handleSelect = (entry: WorkspaceEntry) => {
    const orgSlug = entry.org?.slug ?? "personal";
    switchTo(orgSlug, entry.workspace.slug);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleOrgCreated = async (
    _organization: Organization,
  ): Promise<void> => {
    await refresh();
    navigate("/organizations");
  };

  // New workspace is created in the current context: under the active org, or
  // personal when none is selected. After creating, switch into it.
  const handleWorkspaceCreated = async (
    workspace: Workspace,
  ): Promise<void> => {
    await refresh();
    switchTo(currentOrg?.slug ?? "personal", workspace.slug);
  };

  const handleItemKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = menuItemRefs.current[index + 1];
      next?.focus();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const prev = menuItemRefs.current[index - 1];
      prev?.focus();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted dark:text-text-muted-dark animate-pulse">
        <div className="h-3.5 w-20 rounded bg-border/40 dark:bg-border-dark/40" />
      </div>
    );
  }

  // Separate personal and org workspaces
  const personalWorkspace = availableWorkspaces.find(
    (e) => e.workspace.isPersonal,
  );
  const orgEntries = availableWorkspaces.filter((e) => !e.workspace.isPersonal);

  // Group org entries by org
  const orgGroups = new Map<
    string,
    { orgName: string; entries: WorkspaceEntry[] }
  >();
  for (const entry of orgEntries) {
    const orgId = entry.org?.orgId ?? "unknown";
    const group = orgGroups.get(orgId);
    if (group) {
      group.entries.push(entry);
    } else {
      orgGroups.set(orgId, {
        orgName: entry.org?.name ?? "Unknown Org",
        entries: [entry],
      });
    }
  }

  // Build flat list for keyboard navigation
  const flatList: WorkspaceEntry[] = [];
  if (personalWorkspace) flatList.push(personalWorkspace);
  for (const group of orgGroups.values()) {
    flatList.push(...group.entries);
  }

  const displayLabel = currentOrg
    ? `${currentOrg.name} / ${currentWorkspace?.name ?? "..."}`
    : (currentWorkspace?.name ?? "Personal");

  return (
    <div className="relative" ref={wrapperRef}>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
        className="max-w-[14rem] truncate text-xs font-medium"
        aria-label="Switch workspace"
        aria-haspopup="listbox"
        aria-expanded={open}
        icon={<ChevronDown className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />}
      >
        <span className="truncate">{displayLabel}</span>
      </Button>

      {open && (
        <div
          className="absolute left-0 mt-1.5 w-72 overflow-hidden rounded border border-border bg-surface-raised z-50 dark:border-border-dark dark:bg-surface-dark-raised"
          role="listbox"
          aria-label="Workspaces"
        >
          <div className="border-b border-border/80 px-3 py-2 dark:border-border-dark/80">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark">
              Switch workspace
            </span>
          </div>

          <div className="max-h-80 overflow-y-auto py-1">
            {/* Personal workspace */}
            {personalWorkspace && (
              <WorkspaceItem
                entry={personalWorkspace}
                index={0}
                isActive={
                  !currentOrg &&
                  currentWorkspace?.workspaceId ===
                    personalWorkspace.workspace.workspaceId
                }
                icon={<User className="w-4 h-4 flex-shrink-0" />}
                onSelect={handleSelect}
                onKeyDown={handleItemKeyDown}
                itemRef={(el) => {
                  menuItemRefs.current[0] = el;
                }}
              />
            )}

            {/* Org workspaces */}
            {(() => {
              const orgGroupEntries = Array.from(orgGroups.entries());
              const startIndex = personalWorkspace ? 1 : 0;
              let cumulativeIndex = startIndex;

              return orgGroupEntries.map(([orgId, group]) => {
                const groupStartIndex = cumulativeIndex;
                cumulativeIndex += group.entries.length;

                return (
                  <div key={orgId}>
                    <div className="px-3 pt-2 pb-1">
                      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark">
                        <Building2 className="w-3 h-3" />
                        {group.orgName}
                      </span>
                    </div>
                    {group.entries.map((entry, entryIndex) => {
                      const flatIndex = groupStartIndex + entryIndex;
                      return (
                        <WorkspaceItem
                          key={entry.workspace.workspaceId}
                          entry={entry}
                          index={flatIndex}
                          isActive={
                            currentOrg?.orgId === entry.org?.orgId &&
                            currentWorkspace?.workspaceId ===
                              entry.workspace.workspaceId
                          }
                          icon={<Building2 className="w-4 h-4 flex-shrink-0" />}
                          onSelect={handleSelect}
                          onKeyDown={handleItemKeyDown}
                          itemRef={(el) => {
                            menuItemRefs.current[flatIndex] = el;
                          }}
                        />
                      );
                    })}
                  </div>
                );
              });
            })()}

            {flatList.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-text-muted dark:text-text-muted-dark">
                No workspaces available
              </div>
            )}
          </div>

          {!isSingleUser && (
            <div className="space-y-1 border-t border-border/80 p-2 dark:border-border-dark/80">
              <Button
                variant="ghost"
                size="sm"
                fullWidth
                className="justify-start text-xs"
                icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                onClick={() => {
                  setOpen(false);
                  setCreateWsOpen(true);
                }}
              >
                New workspace
                {currentOrg ? ` in ${currentOrg.name}` : ""}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                fullWidth
                className="justify-start text-xs"
                icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                onClick={() => {
                  setOpen(false);
                  // Billing on: orgs require Teams — go to checkout, not the
                  // direct-create modal (which would 402).
                  if (billing?.billingEnabled) {
                    navigate("/settings/billing");
                  } else {
                    setCreateOrgOpen(true);
                  }
                }}
              >
                Create organization
              </Button>
              <Button
                variant="ghost"
                size="sm"
                fullWidth
                className="justify-start text-xs"
                icon={<ListTree className="h-4 w-4" aria-hidden="true" />}
                onClick={() => {
                  setOpen(false);
                  navigate("/organizations");
                }}
              >
                Manage organizations
              </Button>
            </div>
          )}
        </div>
      )}

      <CreateOrganizationModal
        isOpen={createOrgOpen}
        onClose={() => setCreateOrgOpen(false)}
        onCreated={handleOrgCreated}
      />

      <CreateWorkspaceModal
        isOpen={createWsOpen}
        onClose={() => setCreateWsOpen(false)}
        orgId={currentOrg?.orgId ?? null}
        orgName={currentOrg?.name ?? ""}
        onCreated={handleWorkspaceCreated}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceItem — single row in the dropdown
// ---------------------------------------------------------------------------

interface WorkspaceItemProps {
  entry: WorkspaceEntry;
  index: number;
  isActive: boolean;
  icon: React.ReactNode;
  onSelect: (entry: WorkspaceEntry) => void;
  onKeyDown: (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => void;
  itemRef: (el: HTMLButtonElement | null) => void;
}

function WorkspaceItem({
  entry,
  index,
  isActive,
  icon,
  onSelect,
  onKeyDown,
  itemRef,
}: WorkspaceItemProps) {
  return (
    <button
      ref={itemRef}
      type="button"
      role="option"
      aria-selected={isActive}
      onClick={() => onSelect(entry)}
      onKeyDown={(e) => onKeyDown(e, index)}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors duration-200 motion-reduce:transition-none focus:outline-none ${
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
        <div className="truncate text-sm font-medium">
          {entry.workspace.name}
        </div>
        {entry.org && (
          <div className="truncate text-[11px] text-text-muted dark:text-text-muted-dark">
            {entry.org.name}
          </div>
        )}
      </div>
      {isActive && (
        <span className="flex h-2 w-2 flex-shrink-0 rounded-full bg-primary dark:bg-primary-light" />
      )}
    </button>
  );
}
