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

  const available = agents.isAvailable();

  const refresh = useCallback(() => {
    if (workspaceId === null || !available) return;
    void Promise.all([
      agents.resolveLocalPath(workspaceId, scope),
      agents.listRoster(workspaceId),
    ])
      .then(([resolved, entries]) => {
        setPath(resolved);
        setRoster(entries);
      })
      .catch((cause: unknown) => setError(describe(cause)));
  }, [workspaceId, scope, available]);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDocClick = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        focusTrigger();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEscape);
    };
  }, [menuOpen]);

  const focusTrigger = (): void => {
    triggerWrapRef.current?.querySelector("button")?.focus();
  };

  if (!available || workspaceId === null) return null;

  const chooseFolder = (): void => {
    setMenuOpen(false);
    setBusy(true);
    void agents
      .chooseLocalPath(workspaceId, scope)
      .then((chosen) => {
        if (chosen !== null) refresh();
      })
      .catch((cause: unknown) => setError(describe(cause)))
      .finally(() => setBusy(false));
  };

  const clearFolder = (): void => {
    setMenuOpen(false);
    setBusy(true);
    void agents
      .clearLocalPath(workspaceId, scope)
      .then(() => refresh())
      .catch((cause: unknown) => setError(describe(cause)))
      .finally(() => setBusy(false));
  };

  const launch = (agentKey: string, embedded: boolean): void => {
    setMenuOpen(false);
    setBusy(true);
    setError(null);
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
            .then((session) => onEmbeddedSession(session.sessionId))
        : agents.launchExternal({ workspaceId, agentKey, scope });
    void started
      .catch((cause: unknown) => setError(describe(cause)))
      .finally(() => setBusy(false));
  };

  if (path.localPath === null) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={chooseFolder}
        disabled={busy}
        className={`h-8 whitespace-nowrap ${className ?? ""}`}
        title="Choose the local folder for this project, so agents launch in the right place"
        icon={<FolderOpen className="h-4 w-4" />}
      >
        <span className="hidden lg:inline">Set folder</span>
      </Button>
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

      {menuOpen && (
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
      )}

      {error !== null && (
        <p
          className="absolute top-9 right-0 z-50 max-w-[320px] rounded-sm border border-status-error/40 bg-surface-raised px-3 py-2 text-xs text-status-error dark:bg-surface-dark-raised"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
