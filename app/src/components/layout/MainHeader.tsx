import { useContext } from "react";
import { AppContext } from "../../App";
import { Moon, Sun, Save, Menu } from "lucide-react";
import Tippy from "@tippyjs/react";
import { IconButton } from "../atoms/IconButton";
import type { AppContextType } from "../../types/AppContextType";
import { AccountMenu } from "./AccountMenu";
import useNavigationStore from "../../stores/NavigationStore";
import { useOwnWindowChrome } from "../../stores/WindowChromeStore";
import { WindowControls, dragStyle, noDragStyle } from "./WindowControls";

export function MainHeader() {
  const { darkMode, setDarkMode, autoSaveEnabled, setAutoSaveEnabled } =
    useContext(AppContext) as AppContextType;
  const toggleMobileSidebar = useNavigationStore(
    (state) => state.toggleMobileSidebar,
  );
  // On desktop this header *is* the window chrome: it carries the drag region
  // and the min/max/close buttons, and TitleBar stands down. One bar, not two.
  const ownsChrome = useOwnWindowChrome();

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
        <h1 className="font-sans text-lg font-extrabold tracking-tight text-text-primary dark:text-text-primary-dark">
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
        <Tippy
          content={autoSaveEnabled ? "Auto-save enabled" : "Auto-save disabled"}
          placement="bottom"
        >
          <button
            type="button"
            onClick={() => setAutoSaveEnabled(!autoSaveEnabled)}
            style={noDragStyle}
            aria-label={
              autoSaveEnabled ? "Disable auto-save" : "Enable auto-save"
            }
            className={`inline-flex items-center justify-center w-9 h-9 rounded-sm border transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-2 ${
              autoSaveEnabled
                ? "border-status-success/40 bg-status-success/10 text-status-success hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay"
                : "border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-muted dark:text-text-muted-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay"
            }`}
          >
            <Save className="w-4 h-4" />
          </button>
        </Tippy>

        <Tippy
          content={darkMode ? "Switch to Light mode" : "Switch to Dark mode"}
          placement="bottom"
        >
          <button
            type="button"
            onClick={() => setDarkMode(!darkMode)}
            style={noDragStyle}
            aria-label={
              darkMode ? "Switch to light mode" : "Switch to dark mode"
            }
            className="inline-flex items-center justify-center w-9 h-9 rounded-sm border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-2"
          >
            {darkMode ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>
        </Tippy>

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
