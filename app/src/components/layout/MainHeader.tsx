import { useContext, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppContext } from "../../App";
import { BookOpen, Moon, Sun, Save, Menu } from "lucide-react";
import Tippy from "@tippyjs/react";
import { IconButton } from "../atoms/IconButton";
import type { AppContextType } from "../../types/AppContextType";
import { AccountMenu } from "./AccountMenu";
import useNavigationStore from "../../stores/NavigationStore";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useOwnWindowChrome } from "../../stores/WindowChromeStore";
import { WindowControls, dragStyle, noDragStyle } from "./WindowControls";

/** A tooltip-and-icon toggle button in the drag-region header. Shared by the
 * auto-save and dark-mode toggles, which differ only in copy, styling and icon. */
function HeaderToggleButton({
  enabled,
  onToggle,
  enabledTooltip,
  disabledTooltip,
  enabledAriaLabel,
  disabledAriaLabel,
  className,
  icon,
}: {
  enabled: boolean;
  onToggle: () => void;
  enabledTooltip: string;
  disabledTooltip: string;
  enabledAriaLabel: string;
  disabledAriaLabel: string;
  className: string;
  icon: ReactNode;
}) {
  return (
    <Tippy content={enabled ? enabledTooltip : disabledTooltip} placement="bottom">
      <button
        type="button"
        onClick={onToggle}
        style={noDragStyle}
        aria-label={enabled ? enabledAriaLabel : disabledAriaLabel}
        className={className}
      >
        {icon}
      </button>
    </Tippy>
  );
}

/** The tutorials link's destination, from the current org/workspace or the
 * route params, falling back to "personal" for either. */
function useTutorialsPath() {
  const params = useParams<{ orgSlug?: string; workspaceSlug?: string }>();
  const { currentOrg, currentWorkspace } = useWorkspace();
  const orgSlug = currentOrg?.slug ?? params.orgSlug ?? "personal";
  const workspaceSlug =
    currentWorkspace?.slug ?? params.workspaceSlug ?? "personal";
  return `/${orgSlug}/${workspaceSlug}/tutorials`;
}

export function MainHeader() {
  const { darkMode, setDarkMode, autoSaveEnabled, setAutoSaveEnabled } =
    useContext(AppContext) as AppContextType;
  const toggleMobileSidebar = useNavigationStore(
    (state) => state.toggleMobileSidebar,
  );
  // On desktop this header *is* the window chrome: it carries the drag region
  // and the min/max/close buttons, and TitleBar stands down. One bar, not two.
  const ownsChrome = useOwnWindowChrome();

  const navigate = useNavigate();
  const tutorialsPath = useTutorialsPath();

  return (
    <header
      style={ownsChrome ? dragStyle : undefined}
      className={`navbar h-header min-h-0 w-full gap-3 border-b border-border bg-surface-raised pl-4 text-text-primary transition-colors dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark ${
        ownsChrome ? "select-none pr-0" : "pr-4"
      }`}
    >
      {/* The whole bar is the window's drag handle on desktop; each interactive
          control below opts back out with noDragStyle. Marking only the brand
          would leave most of the bar dead: daisyUI sizes .navbar-start and
          .navbar-end at 50% each and never grows .navbar-center, so the wide
          gap in the middle belongs to those halves, not to a centre spacer. */}
      <div className="navbar-start min-w-0 flex-shrink-0 gap-3">
        <IconButton
          tooltip="Toggle sidebar"
          size="sm"
          onClick={toggleMobileSidebar}
          className="md:hidden flex-shrink-0"
          aria-label="Toggle sidebar"
          style={noDragStyle}
        >
          <Menu className="w-4 h-4" />
        </IconButton>

        <img
          src="/apiweave.png"
          alt="APIWeave Logo"
          className="h-7 w-7 rounded object-cover"
        />
        <h1 className="hidden font-sans text-lg font-extrabold tracking-tight text-text-primary dark:text-text-primary-dark sm:block">
          APIWeave
        </h1>
      </div>

      <div className="navbar-center min-w-0 flex-1 self-stretch" />

      {/* No environment picker here. The canvas toolbar switches the
          environment for the workflow you are actually looking at, which is the
          only place the choice means anything — a second, global one in the
          chrome could only disagree with it. Environments are managed from
          Settings → Environments. */}
      <div className="navbar-end min-w-0 flex-shrink gap-2">
        <div style={noDragStyle}>
          <IconButton
            tooltip="Tutorials"
            size="md"
            variant="secondary"
            onClick={() => navigate(tutorialsPath)}
            className="w-9 h-9"
          >
            <BookOpen className="w-4 h-4" />
          </IconButton>
        </div>

        <HeaderToggleButton
          enabled={autoSaveEnabled}
          onToggle={() => setAutoSaveEnabled(!autoSaveEnabled)}
          enabledTooltip="Auto-save enabled"
          disabledTooltip="Auto-save disabled"
          enabledAriaLabel="Disable auto-save"
          disabledAriaLabel="Enable auto-save"
          className={`inline-flex items-center justify-center w-9 h-9 rounded-sm border transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-2 ${
            autoSaveEnabled
              ? "border-status-success/40 bg-status-success/10 text-status-success hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay"
              : "border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-muted dark:text-text-muted-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay"
          }`}
          icon={<Save className="w-4 h-4" />}
        />

        <HeaderToggleButton
          enabled={darkMode}
          onToggle={() => setDarkMode(!darkMode)}
          enabledTooltip="Switch to Light mode"
          disabledTooltip="Switch to Dark mode"
          enabledAriaLabel="Switch to light mode"
          disabledAriaLabel="Switch to dark mode"
          className="inline-flex items-center justify-center w-9 h-9 rounded-sm border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-2"
          icon={darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        />

        <div className="flex items-center" style={noDragStyle}>
          <AccountMenu />
        </div>
      </div>

      {/* Flush to the window's top-right corner (the header drops its right
          padding for this), the way native window buttons sit. */}
      {ownsChrome && (
        <div className="ml-2 self-stretch">
          <WindowControls />
        </div>
      )}
    </header>
  );
}
