import { useEffect, useState } from "react";
import { Modal } from "../molecules/Modal";
import { Toggle } from "../atoms/Toggle";
import { apiweave } from "../../utils/apiweaveClient";
import type { HttpSafetySettings } from "../../types";

interface PrivateNetworksModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

/**
 * Opt-in for RFC1918/unique-local outbound targets. The SSRF guard blocks
 * these by default (link-local/metadata and multicast stay blocked either
 * way); flipping this toggle persists the choice and takes effect on the
 * shared SafeHttp instance immediately — no restart.
 */
export function PrivateNetworksModal({ isOpen, onClose }: PrivateNetworksModalProps) {
  const [settings, setSettings] = useState<HttpSafetySettings>({
    allowPrivateNetworks: false,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    void apiweave.settings.get().then(setSettings);
  }, [isOpen]);

  const onToggle = (): void => {
    setBusy(true);
    void apiweave.settings
      .setPrivateNetworks(!settings.allowPrivateNetworks)
      .then(setSettings)
      .finally(() => setBusy(false));
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Private networks" size="md">
      <div className="space-y-5 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary dark:text-text-primary-dark">
              Allow private network targets
            </p>
            <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
              Lets HTTP request nodes and URL imports reach RFC1918 and
              unique-local addresses (e.g. 192.168.x.x). Off by default; your
              choice is remembered across restarts. Link-local (169.254.x.x)
              and multicast targets stay blocked.
            </p>
          </div>
          <Toggle
            checked={settings.allowPrivateNetworks}
            onChange={onToggle}
            disabled={busy}
            variant="success"
          />
        </div>
      </div>
    </Modal>
  );
}
