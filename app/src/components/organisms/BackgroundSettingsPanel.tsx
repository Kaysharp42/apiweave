import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { BackgroundSettings } from "@shared/types/BackgroundSettings";
import { ToggleSetting } from "../molecules/ToggleSetting";
import { desktop } from "../../utils/apiweaveClient";

const isLinux = navigator.userAgent.includes("Linux");

/**
 * Keeping APIWeave running with no window open, so the MCP server and git
 * sync stay reachable. Main owns both settings; this only shows and flips them.
 */
export function BackgroundSettingsPanel() {
  const [settings, setSettings] = useState<BackgroundSettings | null>(null);

  useEffect(() => {
    void desktop.getBackground()?.then(setSettings);
  }, []);

  const update = (next: BackgroundSettings) => {
    desktop.setBackground(next).then(setSettings, (error: unknown) => {
      toast.error(
        `Could not change the setting — ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  };

  return (
    <div className="space-y-6">
      <ToggleSetting
        title="Keep running in the tray"
        description={
          "Closing the window hides it to the system tray instead of quitting, " +
          "so agents can still reach the MCP server. Quit from the tray menu."
        }
        checked={settings?.closeToTray ?? false}
        disabled={settings === null}
        onToggle={() =>
          settings && update({ ...settings, closeToTray: !settings.closeToTray })
        }
      />

      <ToggleSetting
        title="Open at login"
        description={
          <>
            Start APIWeave hidden in the tray when you sign in.
            {isLinux && (
              <>
                {" "}
                Uses <code>~/.config/autostart</code>. On Hyprland, Sway or
                another compositor that does not read it, add{" "}
                <code>exec-once = apiweave --hidden</code> to its config
                instead.
              </>
            )}
          </>
        }
        checked={settings?.openAtLogin ?? false}
        disabled={settings === null}
        onToggle={() =>
          settings && update({ ...settings, openAtLogin: !settings.openAtLogin })
        }
      />

      {settings === null && (
        <p className="text-xs text-status-warning">
          These settings are only available in the desktop app.
        </p>
      )}
    </div>
  );
}
