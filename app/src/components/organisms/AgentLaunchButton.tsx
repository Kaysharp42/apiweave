import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronDown,
  ExternalLink,
  FolderOpen,
  Loader2,
  X,
} from "lucide-react";
import type { AgentScope } from "@shared/types/AgentScope";
import type {
  AgentPathResolution,
  AgentRosterEntry,
} from "@shared/types/AgentsBridge";
import type { AgentLaunchMenuItem } from "../../types";
import { Button } from "../atoms/Button";
import { IconButton } from "../atoms/IconButton";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import useAgentRosterStore from "../../stores/AgentRosterStore";
import { useCloseOnOutsideOrEscape } from "../../hooks/useCloseOnOutsideOrEscape";
import { agents } from "../../utils/apiweaveClient";
import { AgentLaunchMenu } from "./AgentLaunchMenu";

/**
 * The scope arrives as two primitives rather than an `AgentScope` object on
 * purpose: it feeds a `useEffect` dependency, and a caller passing an inline
 * `{kind, id}` literal would rebuild it on every render and re-fetch for ever.
 */
interface AgentLaunchButtonProps {
  readonly scopeKind: AgentScope["kind"];
  readonly scopeId: string;
  readonly className?: string;
  /**
   * Given by callers that have somewhere to show a terminal — the canvas
   * toolbar, whose view owns the bottom dock. Its presence is what makes the
   * primary action an embedded session; without it the primary action opens the
   * user's own terminal, which is the honest default for a view with nowhere to
   * put one.
   */
  readonly onEmbeddedSession?: (sessionId: string) => void;
}

const NO_PATH: AgentPathResolution = { localPath: null, source: "none" };

/**
 * The geometry the first PTY is created with, before the terminal has mounted
 * and measured itself. A plausible size rather than a placeholder: the agent may
 * draw its banner before the first resize arrives, and 80 columns would make it
 * wrap for a moment on a wide window.
 */
const INITIAL_COLS = 120;
const INITIAL_ROWS = 30;

/**
 * Launch a coding agent in this scope's folder, MCP already wired.
 *
 * Before a folder is set the control is a folder picker instead of a launcher —
 * showing a launch button that can only fail is worse than showing the one
 * action that actually moves things forward. The picker itself runs in the main
 * process, so the path comes from the OS rather than from this component.
 */
// fallow-ignore-next-line complexity -- the button coordinates folder resolution, roster fetch, launch dispatch and menu state, with one render branch per combination; the menu's own keyboard and focus logic already lives in AgentLaunchMenu, and what remains is the coordination itself
export function AgentLaunchButton({
  scopeKind,
  scopeId,
  className,
  onEmbeddedSession,
}: AgentLaunchButtonProps) {
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.workspaceId ?? null;
  const scope = useMemo<AgentScope>(
    () => ({ kind: scopeKind, id: scopeId }),
    [scopeKind, scopeId],
  );

  const [path, setPath] = useState<AgentPathResolution>(NO_PATH);
  const [roster, setRoster] = useState<readonly AgentRosterEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerWrapRef = useRef<HTMLSpanElement>(null);
  const menuId = useId();
  // Every await below can outlive the toolbar: the canvas toolbar unmounts on a
  // view change, and a folder picker is open for as long as the user takes to
  // pick. Writing state after that is a React warning and, worse, a launch whose
  // failure is reported nowhere.
  const mountedRef = useRef(true);
  const rosterVersion = useAgentRosterStore((state) => state.version);

  const available = agents.isAvailable();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    if (workspaceId === null || !available) return;
    void Promise.all([
      agents.resolveLocalPath(workspaceId, scope),
      agents.listRoster(workspaceId),
    ])
      .then(([resolved, entries]) => {
        if (!mountedRef.current) return;
        setPath(resolved);
        setRoster(entries);
      })
      .catch((cause: unknown) => {
        if (mountedRef.current) setError(describe(cause));
      });
  }, [workspaceId, scope, available]);

  useEffect(() => {
    // `rosterVersion` is read for its dependency and nothing else. The roster is
    // fetched, not pushed — main announces session transitions but says nothing
    // about the agent list — so an add, edit, delete or new default made in
    // Settings → Agents would leave this button offering the old list until it
    // remounted. The store is the renderer's own change ticket.
    void rosterVersion;
    refresh();
  }, [refresh, rosterVersion]);

  // Closing on outside click keeps `menuOpen` authoritative for the menu, but
  // Escape also hands focus back to the trigger — a keyboard user who opened
  // the menu with Enter expects to keep tabbing from where they were.
  useCloseOnOutsideOrEscape(
    menuOpen,
    (reason) => {
      setMenuOpen(false);
      if (reason === "escape") focusTrigger();
    },
    menuRef,
  );

  const focusTrigger = (): void => {
    triggerWrapRef.current?.querySelector("button")?.focus();
  };

  if (!available || workspaceId === null) return null;

  /**
   * What every action does before it starts.
   *
   * The error clear is the point: an error left over from the last attempt sits
   * on screen contradicting the action now in flight, and the user has no way to
   * tell which attempt it belongs to. Each action owns the message slot for its
   * own outcome.
   */
  const beginAction = (): void => {
    setMenuOpen(false);
    setError(null);
    setBusy(true);
  };

  const settle = (): void => {
    if (mountedRef.current) setBusy(false);
  };

  const fail = (cause: unknown): void => {
    if (mountedRef.current) setError(describe(cause));
  };

  const chooseFolder = (): void => {
    beginAction();
    void agents
      .chooseLocalPath(workspaceId, scope)
      .then((chosen) => {
        if (chosen !== null && mountedRef.current) refresh();
      })
      .catch(fail)
      .finally(settle);
  };

  const clearFolder = (): void => {
    beginAction();
    void agents
      .clearLocalPath(workspaceId, scope)
      .then(() => {
        if (mountedRef.current) refresh();
      })
      .catch(fail)
      .finally(settle);
  };

  const launch = (agentKey: string, embedded: boolean): void => {
    beginAction();
    const started =
      embedded && onEmbeddedSession !== undefined
        ? agents
            .launchEmbedded({
              workspaceId,
              agentKey,
              scope,
              cols: INITIAL_COLS,
              rows: INITIAL_ROWS,
            })
            .then((session) => {
              // Opening the dock for a toolbar that has gone would leave a
              // terminal pinned to a view the user has already left.
              if (mountedRef.current) onEmbeddedSession(session.sessionId);
            })
        : agents.launchExternal({ workspaceId, agentKey, scope });
    void started.catch(fail).finally(settle);
  };

  /**
   * The failure popover, built once and rendered by both branches below.
   *
   * The folder-picker branch needs it as much as the launcher branch does — a
   * picker that fails is exactly where the user has no other clue what went
   * wrong — and the earlier version, which only rendered it after a folder was
   * set, swallowed every one of those.
   */
  const errorPopover =
    error === null ? null : (
      <div
        className="absolute top-9 right-0 z-50 flex max-w-[320px] items-start gap-1 rounded-sm border border-status-error/40 bg-surface-raised px-3 py-2 dark:bg-surface-dark-raised"
        role="alert"
      >
        <p className="min-w-0 flex-1 text-xs text-status-error">{error}</p>
        {/*
          Dismissable because the next action may never come: a user who reads a
          launch failure and goes to Settings to fix it would otherwise leave
          this floating over the toolbar for the rest of the session.
        */}
        <IconButton
          tooltip="Dismiss"
          aria-label="Dismiss this error"
          size="xs"
          variant="ghost"
          onClick={() => setError(null)}
        >
          <X className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    );

  if (path.localPath === null) {
    return (
      <span className={`relative inline-flex ${className ?? ""}`}>
        <Button
          variant="ghost"
          size="sm"
          onClick={chooseFolder}
          disabled={busy}
          className="h-8 whitespace-nowrap"
          title="Choose the local folder for this project, so agents launch in the right place"
          icon={<FolderOpen className="h-4 w-4" />}
        >
          <span className="hidden lg:inline">Set folder</span>
        </Button>
        {errorPopover}
      </span>
    );
  }

  const launchable = roster.filter(
    (entry) => entry.availability.state === "ready",
  );
  const preferred =
    launchable.find((entry) => entry.isDefault) ?? launchable[0] ?? null;
  const embeddable = onEmbeddedSession !== undefined;

  const menuItems: AgentLaunchMenuItem[] = launchable.map((entry) => ({
    key: `agent:${entry.definition.agentKey}`,
    icon: Bot,
    label: entry.definition.name,
    onSelect: () => launch(entry.definition.agentKey, true),
  }));
  if (embeddable && preferred !== null) {
    // The Phase 2 path, kept as a choice rather than a fallback: some work
    // wants a terminal that outlives the app window, and this is also what
    // still works if the PTY backend fails to load.
    menuItems.push({
      key: "external",
      icon: ExternalLink,
      label: "Open in my terminal",
      separated: true,
      onSelect: () => launch(preferred.definition.agentKey, false),
    });
  }
  menuItems.push({
    key: "change-folder",
    icon: FolderOpen,
    label: "Change folder…",
    separated: !(embeddable && preferred !== null),
    onSelect: chooseFolder,
  });
  if (path.source === (scope.kind === "project" ? "project" : "workflow")) {
    menuItems.push({
      key: "clear-folder",
      icon: X,
      label: "Clear folder",
      onSelect: clearFolder,
    });
  }

  const handleTriggerKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setMenuOpen(true);
    }
  };

  const closeMenu = (): void => {
    setMenuOpen(false);
    focusTrigger();
  };

  return (
    <div className={`relative flex ${className ?? ""}`} ref={menuRef}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => preferred && launch(preferred.definition.agentKey, true)}
        disabled={busy || preferred === null}
        className="h-8 whitespace-nowrap rounded-r-none"
        title={
          preferred === null
            ? "No working agent CLI was found — check Settings → Agents"
            : `${embeddable ? "Run" : "Launch"} ${preferred.definition.name} in ${path.localPath}`
        }
        icon={
          busy ? (
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          ) : (
            <Bot className="h-4 w-4" />
          )
        }
      >
        <span className="hidden lg:inline">
          {preferred === null ? "No agent" : preferred.definition.name}
        </span>
      </Button>
      <span ref={triggerWrapRef} className="inline-flex">
        <IconButton
          onClick={() => setMenuOpen((open) => !open)}
          onKeyDown={handleTriggerKeyDown}
          tooltip="Agent options"
          aria-label="Agent options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          variant="ghost"
          size="sm"
          className="h-8 rounded-l-none border-l border-border dark:border-border-dark"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${menuOpen ? "rotate-180" : ""}`}
          />
        </IconButton>
      </span>

      {/*
        One popover slot, not two. The menu and the error both hang off the same
        `top-9 right-0` anchor, and rendering them together stacked an
        unreadable error on top of the menu items it was describing. The error
        does not go away while the menu is open — it is state, and it comes back
        when the menu closes without a choice being made.
      */}
      {menuOpen ? (
        <AgentLaunchMenu
          id={menuId}
          headerLabel={
            path.source === "project" && scope.kind === "workflow"
              ? "Folder — inherited from project"
              : "Folder"
          }
          folderPath={path.localPath}
          empty={launchable.length === 0}
          items={menuItems}
          onClose={closeMenu}
        />
      ) : (
        errorPopover
      )}
    </div>
  );
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
