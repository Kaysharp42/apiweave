import { useEffect, useState } from "react";
import { ToggleSetting } from "../molecules/ToggleSetting";
import { apiweave } from "../../utils/apiweaveClient";
import type { HttpSafetySettings } from "../../types";

/**
 * Opt-in for RFC1918/unique-local outbound targets. The SSRF guard blocks
 * these by default (link-local/metadata and multicast stay blocked either
 * way); flipping this toggle persists the choice and takes effect on the
 * shared SafeHttp instance immediately — no restart.
 */
export function PrivateNetworksPanel() {
  const [settings, setSettings] = useState<HttpSafetySettings>({
    allowPrivateNetworks: false,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void apiweave.settings.get().then(setSettings);
  }, []);

  const onToggle = (): void => {
    setBusy(true);
    void apiweave.settings
      .setPrivateNetworks(!settings.allowPrivateNetworks)
      .then(setSettings)
      .finally(() => setBusy(false));
  };

  return (
    <ToggleSetting
      title="Allow private network targets"
      description={
        "Lets HTTP request nodes and URL imports reach RFC1918 and " +
        "unique-local addresses (e.g. 192.168.x.x). Off by default; your " +
        "choice is remembered across restarts. Link-local (169.254.x.x) " +
        "and multicast targets stay blocked."
      }
      checked={settings.allowPrivateNetworks}
      onToggle={onToggle}
      disabled={busy}
    />
  );
}
