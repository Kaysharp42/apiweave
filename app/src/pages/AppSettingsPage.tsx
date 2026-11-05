import { Suspense, type ComponentType } from "react";
import { Navigate, useParams } from "react-router";
import { APP_SETTINGS_SECTIONS } from "../constants/appSettingsSections";
import { Spinner } from "../components/atoms/Spinner";
import type { AppSettingsSectionMeta } from "../types";
import { lazyNamed } from "../utils/lazyNamed";

/**
 * The app-scoped settings, keyed by the last URL segment. These used to be
 * modals opened from the sidebar, which put a dialog over the page the user was
 * already on — see `SettingsContent`, which now just navigates here.
 *
 * The metadata is in `constants/appSettingsSections`; each panel is its own
 * chunk, fetched when its page opens. Importing the seven panels here would put
 * all of them in the route chunk, which is the thing the route split is for.
 */
const APP_SETTING_PANELS: Readonly<Record<string, ComponentType>> = {
  agents: lazyNamed(
    () => import("../components/organisms/AgentsSettingsPanel"),
    "AgentsSettingsPanel",
  ),
  background: lazyNamed(
    () => import("../components/organisms/BackgroundSettingsPanel"),
    "BackgroundSettingsPanel",
  ),
  canvas: lazyNamed(
    () => import("../components/organisms/CanvasSettingsPanel"),
    "CanvasSettingsPanel",
  ),
  "git-accounts": lazyNamed(
    () => import("../components/organisms/GitAccountsSettingsPanel"),
    "GitAccountsSettingsPanel",
  ),
  "mcp-server": lazyNamed(
    () => import("../components/organisms/McpSetupPanel"),
    "McpSetupPanel",
  ),
  network: lazyNamed(
    () => import("../components/organisms/NetworkSettingsPanel"),
    "NetworkSettingsPanel",
  ),
  updates: lazyNamed(
    () => import("../components/organisms/UpdateSettingsPanel"),
    "UpdateSettingsPanel",
  ),
};

export function AppSettingsPage() {
  const { orgSlug, workspaceSlug, section } = useParams<{
    orgSlug: string;
    workspaceSlug: string;
    section: string;
  }>();
  const entry: AppSettingsSectionMeta | undefined =
    section === undefined ? undefined : APP_SETTINGS_SECTIONS[section];
  const Panel = section === undefined ? undefined : APP_SETTING_PANELS[section];

  // An unknown /settings/* segment lands on the first settings page rather than
  // a 404 inside the shell — the sidebar it arrived from is still standing.
  if (!entry || Panel === undefined) {
    return (
      <Navigate
        to={`/${orgSlug}/${workspaceSlug}/settings/environments`}
        replace
      />
    );
  }

  const { icon: Icon, title, subtitle, width } = entry;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-6 border-b border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
        <Icon
          className="w-5 h-5 text-text-secondary dark:text-text-secondary-dark"
          aria-hidden="true"
        />
        <div>
          <h1 className="text-3xl font-bold font-display tracking-tight text-text-primary dark:text-text-primary-dark">
            {title}
          </h1>
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
            {subtitle}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className={width}>
          <Suspense
            fallback={
              <div className="flex justify-center p-6">
                <Spinner size="lg" />
              </div>
            }
          >
            <Panel />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
