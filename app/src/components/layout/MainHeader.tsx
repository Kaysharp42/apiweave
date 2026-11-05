import { useContext, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { AppContext } from "../../contexts/AppContext";
import { BookOpen, Moon, Sun, Menu } from "lucide-react";
import { Tooltip } from "../atoms/Tooltip";
import { IconButton } from "../atoms/IconButton";
import type { AppContextType } from "../../types/AppContextType";
import useNavigationStore from "../../stores/NavigationStore";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useWorkspaceGitStatus } from "../../hooks/useWorkspaceGitStatus";
import { useOwnWindowChrome } from "../../stores/WindowChromeStore";
import { GitAccountsMenu } from "./GitAccountsMenu";
import { GitSyncControl } from "./GitSyncControl";
import {
  dragStyle,
  noDragStyle,
  WINDOW_CONTROLS_INSET,
} from "../../utils/windowDragStyles";

/** A tooltip-and-icon toggle button in the drag-region header, used by the
 * theme override. */
function HeaderToggleButton({
  onToggle,
  tooltip,
  ariaLabel,
  className,
  icon,
}: {
  onToggle: () => void;
  tooltip: string;
  ariaLabel: string;
  className: string;
  icon: ReactNode;
}) {
  return (
    <Tooltip delay={0} content={tooltip} placement="bottom">
      <button
        type="button"
        onClick={onToggle}
        style={noDragStyle}
        aria-label={ariaLabel}
        className={className}
      >
        {icon}
      </button>
    </Tooltip>
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
  const { darkMode, themePreference, setThemePreference } = useContext(
    AppContext,
  ) as AppContextType;
  const nextTheme = darkMode ? "Light" : "Dark";
  const effectiveMode = darkMode ? "Dark" : "Light";
  const preferenceSuffix = themePreference === "system" ? " (system)" : "";
  const themeActionLabel = `Theme: ${effectiveMode}${preferenceSuffix} — switch to ${nextTheme}`;
  const toggleMobileSidebar = useNavigationStore(
    (state) => state.toggleMobileSidebar,
  );
  // On desktop this header *is* the window chrome: it carries the drag region,
  // and the native window controls are drawn over its top-right corner, so it
  // reserves that corner instead of putting its own buttons there.
  const ownsChrome = useOwnWindowChrome();

  const navigate = useNavigate();
  const tutorialsPath = useTutorialsPath();
  // One feed for the header: the sync control says where the workspace stands,
  // and the accounts menu knows whose account it syncs as.
  const { currentWorkspace } = useWorkspace();
  const gitStatus = useWorkspaceGitStatus(currentWorkspace?.workspaceId ?? null);

  return (
    <header
      style={
        ownsChrome
          ? { ...dragStyle, paddingRight: WINDOW_CONTROLS_INSET }
          : undefined
      }
      className={`aw-window-chrome navbar h-header min-h-0 w-full gap-3 border-b border-border bg-surface-raised pl-4 text-text-primary transition-colors dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark ${
        ownsChrome ? "select-none pr-0" : "pr-4"
      }`}
    >
      {/* The whole bar is the window's drag handle on desktop; each interactive
          control below opts back out with noDragStyle. Marking only the brand
          would leave most of the bar dead: daisyUI sizes .navbar-start and
          .navbar-end at 50% each and never grows .navbar-center, so the wide
          gap in the middle belongs to those halves, not to a centre spacer. */}
      <div className="navbar-start min-w-0 shrink-0 gap-3">
        <IconButton
          tooltip="Toggle sidebar"
          size="sm"
          onClick={toggleMobileSidebar}
          className="md:hidden shrink-0"
          aria-label="Toggle sidebar"
          style={noDragStyle}
        >
          <Menu className="w-4 h-4" />
        </IconButton>

        <img
          src="/apiweave.png"
          alt=""
          aria-hidden="true"
          className="h-7 w-7 rounded-sm object-cover"
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
      <div className="navbar-end min-w-0 shrink gap-2">
        <GitSyncControl feed={gitStatus} />

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
          onToggle={() => setThemePreference(darkMode ? "light" : "dark")}
          tooltip={themeActionLabel}
          ariaLabel={themeActionLabel}
          className="inline-flex items-center justify-center w-9 h-9 rounded-xs border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:outline-offset-2"
          icon={darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        />

        <GitAccountsMenu status={gitStatus.status} />
      </div>
    </header>
  );
}
