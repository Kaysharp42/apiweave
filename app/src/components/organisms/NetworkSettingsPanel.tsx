import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../atoms/Button";
import { IconButton } from "../atoms/IconButton";
import { Input } from "../atoms/Input";
import { Card } from "../molecules/Card";
import { FormField } from "../molecules/FormField";
import { ToggleSetting } from "../molecules/ToggleSetting";
import { network } from "../../utils/apiweaveClient";
import type { ClientCertificateSetting } from "@shared/types/ClientCertificateSetting";
import type { NetworkSettings } from "@shared/types/NetworkSettings";
import type { NetworkSettingsState } from "@shared/types/NetworkSettingsState";

interface FileChooserProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (path: string) => void;
}

/** A file path chosen in the native picker: main reads it, the renderer only ever holds the path. */
function FileChooser({ label, value, onChange }: FileChooserProps) {
  const choose = (): void => {
    void network.chooseFile().then((path) => {
      if (path !== null) onChange(path);
    });
  };
  return (
    <FormField label={label}>
      <div className="flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary dark:text-text-secondary-dark"
          title={value}
        >
          {value || "None"}
        </span>
        <Button size="sm" variant="outline" onClick={choose}>
          Choose…
        </Button>
        {value && (
          <IconButton
            size="sm"
            tooltip={`Clear ${label.toLowerCase()}`}
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => onChange("")}
          >
            <X className="h-3.5 w-3.5" />
          </IconButton>
        )}
      </div>
    </FormField>
  );
}

/**
 * Settings > Network: the proxy, trusted CAs and client certificates every
 * request uses. Saved through a privileged bridge main validates against the
 * files themselves; credentials are write-only — the state only says whether
 * one is stored.
 */
export function NetworkSettingsPanel() {
  const [state, setState] = useState<NetworkSettingsState | null>(null);
  const [draft, setDraft] = useState<NetworkSettings | null>(null);
  const [proxyPassword, setProxyPassword] = useState("");
  const [passphrases, setPassphrases] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (next: NetworkSettingsState): void => {
    setState(next);
    setDraft(next.settings);
    setProxyPassword("");
    setPassphrases({});
  };

  useEffect(() => {
    void network.get().then(load, (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, []);

  if (draft === null || state === null) {
    return error ? (
      <p className="text-sm text-status-error dark:text-[var(--aw-status-error)]">
        {error}
      </p>
    ) : null;
  }

  const update = (patch: Partial<NetworkSettings>): void =>
    setDraft({ ...draft, ...patch });
  const updateCertificate = (
    id: string,
    patch: Partial<ClientCertificateSetting>,
  ): void =>
    update({
      clientCertificates: draft.clientCertificates.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry,
      ),
    });

  const save = (): void => {
    setSaving(true);
    setError(null);
    void network
      .save({
        settings: draft,
        ...(proxyPassword ? { proxyPassword } : {}),
        passphrases: Object.fromEntries(
          Object.entries(passphrases).filter(([, value]) => value !== ""),
        ),
      })
      .then((next) => {
        load(next);
        toast.success("Network settings saved");
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setSaving(false));
  };

  const problem = error ?? state.problem;

  return (
    <div className="space-y-4">
      <Card title="Proxy">
        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            label="Proxy URL"
            hint="Every request goes through it. Leave empty to connect directly."
            className="md:col-span-2"
          >
            <Input
              value={draft.proxyUrl}
              onChange={(event) => update({ proxyUrl: event.target.value })}
              placeholder="http://proxy.example.com:8080"
              className="font-mono"
            />
          </FormField>
          <FormField
            label="Bypass the proxy for"
            hint="Comma-separated hosts, NO_PROXY syntax: .example.com covers its subdomains."
            className="md:col-span-2"
          >
            <Input
              value={draft.proxyBypass}
              onChange={(event) => update({ proxyBypass: event.target.value })}
              className="font-mono"
            />
          </FormField>
          <FormField label="Username">
            <Input
              value={draft.proxyUsername}
              onChange={(event) =>
                update({ proxyUsername: event.target.value })
              }
              autoComplete="off"
            />
          </FormField>
          <FormField
            label="Password"
            hint="Stored encrypted; removed with the username."
          >
            <Input
              type="password"
              value={proxyPassword}
              onChange={(event) => setProxyPassword(event.target.value)}
              placeholder={
                state.proxyPasswordSet ? "Saved — type to replace" : ""
              }
              autoComplete="new-password"
            />
          </FormField>
        </div>
      </Card>

      <Card title="Trusted certificate authorities">
        <div className="space-y-4">
          <ToggleSetting
            title="Trust the operating system's certificates"
            description="Accept servers signed by a CA installed in the system store, such as a corporate root, in addition to the CAs APIWeave ships with."
            checked={draft.useSystemCa}
            onToggle={() => update({ useSystemCa: !draft.useSystemCa })}
          />
          {draft.caCertificateFiles.map((file) => (
            <div key={file} className="flex items-center gap-2">
              <span
                className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary dark:text-text-primary-dark"
                title={file}
              >
                {file}
              </span>
              <IconButton
                size="sm"
                tooltip="Remove CA certificate"
                aria-label={`Remove ${file}`}
                onClick={() =>
                  update({
                    caCertificateFiles: draft.caCertificateFiles.filter(
                      (other) => other !== file,
                    ),
                  })
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => {
              void network.chooseFile().then((path) => {
                if (path !== null && !draft.caCertificateFiles.includes(path)) {
                  update({
                    caCertificateFiles: [...draft.caCertificateFiles, path],
                  });
                }
              });
            }}
          >
            Add CA certificate (PEM)…
          </Button>
        </div>
      </Card>

      <Card title="Client certificates">
        <div className="space-y-4">
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
            Presented to servers that ask for one (mutual TLS). The first entry
            whose host matches the request is used.
          </p>
          {draft.clientCertificates.map((entry) => (
            <div
              key={entry.id}
              className="grid gap-3 border-t border-border pt-4 dark:border-border-dark md:grid-cols-2"
            >
              <FormField
                label="Host"
                hint="api.example.com, *.example.com, optionally with :port."
              >
                <Input
                  value={entry.host}
                  onChange={(event) =>
                    updateCertificate(entry.id, { host: event.target.value })
                  }
                  className="font-mono"
                />
              </FormField>
              <FormField
                label="Passphrase"
                hint="For an encrypted key or a PFX. Stored encrypted."
              >
                <Input
                  type="password"
                  value={passphrases[entry.id] ?? ""}
                  onChange={(event) =>
                    setPassphrases({
                      ...passphrases,
                      [entry.id]: event.target.value,
                    })
                  }
                  placeholder={
                    state.passphraseSet.includes(entry.id)
                      ? "Saved — type to replace"
                      : ""
                  }
                  autoComplete="new-password"
                />
              </FormField>
              <FileChooser
                label="Certificate (PEM)"
                value={entry.certFile}
                onChange={(certFile) =>
                  updateCertificate(entry.id, { certFile })
                }
              />
              <FileChooser
                label="Key (PEM)"
                value={entry.keyFile}
                onChange={(keyFile) => updateCertificate(entry.id, { keyFile })}
              />
              <FileChooser
                label="Or PFX / PKCS#12"
                value={entry.pfxFile}
                onChange={(pfxFile) => updateCertificate(entry.id, { pfxFile })}
              />
              <div className="flex items-end justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() =>
                    update({
                      clientCertificates: draft.clientCertificates.filter(
                        (other) => other.id !== entry.id,
                      ),
                    })
                  }
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() =>
              update({
                clientCertificates: [
                  ...draft.clientCertificates,
                  {
                    id: crypto.randomUUID(),
                    host: "",
                    certFile: "",
                    keyFile: "",
                    pfxFile: "",
                  },
                ],
              })
            }
          >
            Add client certificate
          </Button>
        </div>
      </Card>

      {problem && (
        <p
          role="alert"
          className="text-sm text-status-error dark:text-[var(--aw-status-error)]"
        >
          {problem}
        </p>
      )}
      <div className="flex justify-end">
        <Button variant="primary" loading={saving} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}
