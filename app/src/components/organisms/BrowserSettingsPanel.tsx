import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Select } from "../atoms/Select";
import { Card } from "../molecules/Card";
import { FormField } from "../molecules/FormField";
import { ToggleSetting } from "../molecules/ToggleSetting";
import { browser } from "../../utils/apiweaveClient";
import type { BrowserChannel } from "@shared/types/BrowserChannel";
import type { BrowserSettings } from "@shared/types/BrowserSettings";

const CHANNELS: readonly { readonly value: BrowserChannel; readonly label: string }[] = [
  { value: "chrome", label: "Google Chrome" },
  { value: "msedge", label: "Microsoft Edge" },
  { value: "chromium", label: "Playwright Chromium" },
];

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Settings > Browser: which installed browser runs browser steps, and whether
 * its window shows. Per machine, saved as soon as it changes, through a
 * privileged bridge no agent can reach.
 */
export function BrowserSettingsPanel() {
  const [settings, setSettings] = useState<BrowserSettings | null>(null);
  // Null while the check runs: it starts each browser once, which takes a moment.
  const [installed, setInstalled] = useState<readonly BrowserChannel[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void browser.getSettings().then(setSettings, (cause: unknown) => setError(message(cause)));
    void browser.listInstalled().then(setInstalled, () => setInstalled([]));
  }, []);

  if (settings === null) {
    return error ? <p className="text-sm text-status-error dark:text-(--aw-status-error)">{error}</p> : null;
  }

  const save = (next: BrowserSettings): void => {
    const previous = settings;
    setSettings(next);
    setError(null);
    void browser.setSettings(next).then(
      (saved) => {
        setSettings(saved);
        toast.success("Browser settings saved");
      },
      (cause: unknown) => {
        setSettings(previous);
        setError(message(cause));
      },
    );
  };

  const firstInstalled = installed === null ? null : CHANNELS.find((channel) => installed.includes(channel.value));
  const automatic = installed === null
    ? "Automatic (checking which browsers are installed…)"
    : `Automatic${firstInstalled ? ` (${firstInstalled.label})` : " (none found)"}`;
  const chosenMissing = settings.channel !== undefined && installed !== null && !installed.includes(settings.channel);

  return (
    <div className="space-y-4">
      <Card title="Browser for browser steps">
        <div className="space-y-4">
          <FormField
            label="Browser"
            hint="Runs use a fresh, empty profile: your own browsing data, logins and extensions are never touched."
          >
            <Select
              value={settings.channel ?? ""}
              onChange={(event) => {
                const channel = CHANNELS.find((entry) => entry.value === event.target.value)?.value;
                save(channel === undefined ? { showBrowser: settings.showBrowser } : { ...settings, channel });
              }}
            >
              <option value="">{automatic}</option>
              {CHANNELS.map((channel) => (
                <option key={channel.value} value={channel.value}>
                  {channel.label}
                  {installed !== null && !installed.includes(channel.value) ? " (not found)" : ""}
                </option>
              ))}
            </Select>
          </FormField>
          {chosenMissing ? (
            <p role="alert" className="text-sm text-status-warning dark:text-(--aw-status-warning)">
              This browser did not start on this machine, so browser steps will fail. Choose another one, or Automatic.
            </p>
          ) : null}
          {installed !== null && installed.length === 0 ? (
            <p role="alert" className="text-sm text-status-warning dark:text-(--aw-status-warning)">
              No supported browser was found. Install Google Chrome or Microsoft Edge to run browser steps.
            </p>
          ) : null}
          <ToggleSetting
            title="Show the browser during runs"
            description="Runs you start from the app open a visible window, so you can watch the steps. Runs an agent starts always stay hidden."
            checked={settings.showBrowser}
            onToggle={() => save({ ...settings, showBrowser: !settings.showBrowser })}
          />
        </div>
      </Card>
      {error ? (
        <p role="alert" className="text-sm text-status-error dark:text-(--aw-status-error)">
          {error}
        </p>
      ) : null}
    </div>
  );
}
