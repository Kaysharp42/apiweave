import { useContext, useEffect, useState } from "react";
import { Popover, Transition } from "@headlessui/react";
import { Link, useParams } from "react-router-dom";
import { AppContext } from "../../App";
import {
  Moon,
  Sun,
  Folder,
  Save,
  Menu,
  ChevronDown,
  Settings,
  Globe,
} from "lucide-react";
import Tippy from "@tippyjs/react";
import { Button } from "../atoms/Button";
import { IconButton } from "../atoms/IconButton";
import type { AppContextType } from "../../types/AppContextType";
import { AccountMenu } from "./AccountMenu";
import useNavigationStore from "../../stores/NavigationStore";
import useEnvironmentStore from "../../stores/EnvironmentStore";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useOwnWindowChrome } from "../../stores/WindowChromeStore";
import { WindowControls, dragStyle, noDragStyle } from "./WindowControls";

export function MainHeader() {
  const { darkMode, setDarkMode, autoSaveEnabled, setAutoSaveEnabled } =
    useContext(AppContext) as AppContextType;
  const [defaultEnvId, setDefaultEnvId] = useState(
    () => localStorage.getItem("defaultEnvironment") ?? "",
  );
  const toggleMobileSidebar = useNavigationStore(
    (state) => state.toggleMobileSidebar,
  );
  const environments = useEnvironmentStore((state) => state.environments);
  const { currentOrg, currentWorkspace } = useWorkspace();
  // On desktop this header *is* the window chrome: it carries the drag region
  // and the min/max/close buttons, and TitleBar stands down. One bar, not two.
  const ownsChrome = useOwnWindowChrome();
  const { orgSlug, workspaceSlug } = useParams<{
    orgSlug?: string;
    workspaceSlug?: string;
  }>();

  useEffect(() => {
    const syncDefaultEnvironment = () => {
      setDefaultEnvId(localStorage.getItem("defaultEnvironment") ?? "");
    };

    window.addEventListener("storage", syncDefaultEnvironment);
    window.addEventListener("focus", syncDefaultEnvironment);
    return () => {
      window.removeEventListener("storage", syncDefaultEnvironment);
      window.removeEventListener("focus", syncDefaultEnvironment);
    };
  }, []);

  const selectedEnvironment = environments.find(
    (env) => env.environmentId === defaultEnvId,
  );
  const selectedEnvironmentName = selectedEnvironment?.name ?? "No Environment";
  const manageOrgSlug = currentOrg?.slug ?? orgSlug ?? "personal";
  const manageWorkspaceSlug =
    currentWorkspace?.slug ?? workspaceSlug ?? "personal";
  const manageEnvironmentsPath = `/${manageOrgSlug}/${manageWorkspaceSlug}/settings/environments`;

  const handleEnvironmentSelect = (envId: string) => {
    useEnvironmentStore.getState().setDefaultEnv(envId);
    setDefaultEnvId(envId);
  };

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

      <div className="navbar-end min-w-0 flex-shrink gap-2">
        <Popover className="relative flex-shrink min-w-0" style={noDragStyle}>
          {({ open, close }) => (
            <>
              <Popover.Button
                as={Button}
                variant="outline"
                size="sm"
                title="Select default environment"
                className="h-9 min-w-0 max-w-[12rem] px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 dark:focus-visible:outline-primary-light"
                icon={<Folder className="w-4 h-4 flex-shrink-0" />}
                aria-label="Select default environment"
              >
                <span className="hidden min-w-0 truncate sm:inline">
                  {selectedEnvironmentName}
                </span>
                <ChevronDown
                  className={`w-3.5 h-3.5 flex-shrink-0 transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </Popover.Button>

              <Transition
                enter="transition duration-150 ease-out"
                enterFrom="opacity-0 translate-y-1 scale-95"
                enterTo="opacity-100 translate-y-0 scale-100"
                leave="transition duration-100 ease-in"
                leaveFrom="opacity-100 translate-y-0 scale-100"
                leaveTo="opacity-0 translate-y-1 scale-95"
              >
                <Popover.Panel className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-md border border-border bg-surface-raised shadow-lg dark:border-border-dark dark:bg-surface-dark-raised">
                  <div className="border-b border-border px-3 py-2 dark:border-border-dark">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark">
                      Default environment
                    </span>
                  </div>

                  <div
                    className="max-h-72 overflow-y-auto py-1"
                    role="listbox"
                    aria-label="Default environments"
                  >
                    {environments.length === 0 ? (
                      <div className="px-3 py-3 text-sm text-text-muted dark:text-text-muted-dark">
                        No environments available.
                      </div>
                    ) : (
                      environments.map((env) => {
                        const isSelected = env.environmentId === defaultEnvId;

                        return (
                          <Button
                            key={env.environmentId}
                            variant="ghost"
                            size="sm"
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => {
                              handleEnvironmentSelect(env.environmentId);
                              close();
                            }}
                            className={`w-full justify-start rounded-none px-3 py-2 text-left transition-colors duration-150 motion-reduce:transition-none ${
                              isSelected
                                ? "bg-primary/10 text-primary dark:bg-primary-light/10 dark:text-primary-light"
                                : "text-text-primary hover:bg-primary/10 dark:text-text-primary-dark dark:hover:bg-primary-light/10"
                            }`}
                            icon={<Globe className="w-4 h-4 flex-shrink-0" />}
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {env.name}
                            </span>
                            <span className="ml-auto rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary dark:border-border-dark dark:text-text-secondary-dark">
                              {env.scopeType}
                            </span>
                          </Button>
                        );
                      })
                    )}
                  </div>

                  <div className="border-t border-border p-1 dark:border-border-dark">
                    <Link
                      to={manageEnvironmentsPath}
                      onClick={() => close()}
                      className="flex items-center gap-2 rounded px-3 py-2 text-sm font-medium text-text-secondary transition-colors duration-150 hover:bg-surface-overlay hover:text-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 dark:text-text-secondary-dark dark:hover:bg-surface-dark-overlay dark:hover:text-primary-light dark:focus-visible:outline-primary-light"
                    >
                      <Settings
                        className="w-4 h-4 flex-shrink-0"
                        aria-hidden="true"
                      />
                      <span>Manage Environments →</span>
                    </Link>
                  </div>
                </Popover.Panel>
              </Transition>
            </>
          )}
        </Popover>

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
