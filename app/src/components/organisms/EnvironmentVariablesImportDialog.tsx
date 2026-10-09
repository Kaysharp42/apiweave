import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { parseVariablesFile } from "@shared/env-file/envFile";
import { Badge } from "../atoms/Badge";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { Toggle } from "../atoms/Toggle";
import { Modal } from "../molecules/Modal";
import {
  fetchScopedPublicKey,
  listScopedSecrets,
  postScopedEncryptedSecret,
} from "../../hooks/useSecretValues";
import { encryptSecretValue } from "../../utils/encryptSecretValue";
import { envImportStatus, planEnvImport } from "../../utils/environmentImport";
import type {
  EnvImportRow,
  EnvImportStatus,
  EnvironmentVariablesImportDialogProps,
} from "../../types";

const STATUS_BADGE: Record<
  EnvImportStatus,
  { label: string; variant: "success" | "warning" | "ghost" }
> = {
  new: { label: "New", variant: "success" },
  changed: { label: "Changed", variant: "warning" },
  exists: { label: "Replaces secret", variant: "warning" },
  unchanged: { label: "Unchanged", variant: "ghost" },
};

/**
 * Import variables from a .env, flat JSON or Postman environment file. Each
 * row is a plain variable or a secret (credential-looking keys default to
 * secret); secrets are sealed into the environment's secret store on import
 * and never shown, plain variables are merged into the form.
 */
export function EnvironmentVariablesImportDialog({
  isOpen,
  environment,
  variables,
  onClose,
  onImported,
}: EnvironmentVariablesImportDialogProps) {
  const [rows, setRows] = useState<EnvImportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [secretNames, setSecretNames] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const environmentId = environment.environmentId;
  const workspaceId =
    environment.scopeType === "workspace" ? environment.scopeId : undefined;

  useEffect(() => {
    if (!isOpen) return;
    listScopedSecrets("environment", environmentId, workspaceId)
      .then((secrets) => setSecretNames(new Set(secrets.map((s) => s.name))))
      .catch(() => setSecretNames(new Set()));
  }, [isOpen, environmentId, workspaceId]);

  // Values held here can be credentials: drop them as soon as the dialog closes.
  const close = () => {
    setRows(null);
    setError(null);
    onClose();
  };

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setRows(null);
    setError(null);
    if (!file) return;
    try {
      const parsed = parseVariablesFile(await file.text());
      if (parsed.variables.length === 0) {
        setError(`${file.name} has no variables`);
        return;
      }
      setRows(
        parsed.variables.map(({ key, value, suggestSecret }) => ({
          key,
          value,
          asSecret: suggestSecret,
        })),
      );
    } catch (parseError: unknown) {
      setError(
        parseError instanceof SyntaxError
          ? `${file.name} is not valid JSON`
          : parseError instanceof Error
            ? parseError.message
            : `Cannot read ${file.name}`,
      );
    }
  };

  const toggleSecret = (key: string, asSecret: boolean) =>
    setRows((current) =>
      current?.map((row) => (row.key === key ? { ...row, asSecret } : row)) ??
      null,
    );

  const plan = rows && planEnvImport(rows, variables, secretNames, overwrite);
  const variableCount = plan
    ? Object.keys(plan.variables).filter(
        (key) => plan.variables[key] !== variables[key],
      ).length
    : 0;
  const writes = variableCount + (plan?.secrets.length ?? 0);

  const handleImport = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      if (plan.secrets.length > 0) {
        const key = await fetchScopedPublicKey(
          "environment",
          environmentId,
          workspaceId,
        );
        for (const secret of plan.secrets) {
          const sealed = await encryptSecretValue(secret.value, {
            keyId: key.keyId,
            publicKey: key.publicKey,
            algorithm: "libsodium-sealed-box",
          });
          await postScopedEncryptedSecret({
            scopeType: "environment",
            scopeId: environmentId,
            ...(workspaceId ? { workspaceId } : {}),
            name: secret.name,
            sealed,
            keyId: key.keyId,
          });
        }
      }
      onImported(plan.variables);
      toast.success(
        `Imported ${variableCount} variable(s) and stored ${plan.secrets.length} secret(s).` +
          (variableCount > 0 ? " Save the environment to keep the variables." : ""),
      );
      close();
    } catch (importError: unknown) {
      setError(
        `Import failed: ${importError instanceof Error ? importError.message : "unknown error"}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={`Import variables: ${environment.name}`}
      size="lg"
      footer={() => (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!plan || writes === 0}
            onClick={() => void handleImport()}
          >
            {writes > 0 ? `Import ${writes}` : "Import"}
          </Button>
        </div>
      )}
    >
      <div className="space-y-4 p-5">
        <Input
          type="file"
          label=".env, JSON object or Postman environment"
          accept=".env,.json,.txt,text/plain,application/json"
          onChange={(event) => void pick(event)}
        />

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 text-sm text-status-error dark:text-[var(--aw-status-error)]"
          >
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" /> {error}
          </p>
        )}

        {rows && (
          <>
            <Toggle
              label="Overwrite existing values (otherwise they are kept)"
              checked={overwrite}
              onChange={(event) => setOverwrite(event.target.checked)}
            />
            <ul className="divide-y divide-border rounded border border-border dark:divide-border-dark dark:border-border-dark">
              {rows.map((row) => {
                const status = envImportStatus(row, variables, secretNames);
                const badge = STATUS_BADGE[status];
                return (
                  <li key={row.key} className="flex items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-sm text-text-primary dark:text-text-primary-dark">
                        {row.key}
                      </span>
                      <span className="block truncate font-mono text-xs text-text-muted dark:text-text-muted-dark">
                        {row.asSecret ? "•••••••• (stored as a secret)" : row.value || "(empty)"}
                      </span>
                    </span>
                    <Badge variant={badge.variant} size="sm">
                      {badge.label}
                    </Badge>
                    <Toggle
                      label="Secret"
                      aria-label={`Store ${row.key} as a secret`}
                      checked={row.asSecret}
                      onChange={(event) => toggleSecret(row.key, event.target.checked)}
                    />
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-text-muted dark:text-text-muted-dark">
              Secrets are sealed into this environment's secret store as{" "}
              <code>{"{{secrets.NAME}}"}</code> and never shown again. Plain
              variables are added to the form; save the environment to keep
              them.
              {plan && plan.kept > 0 ? ` ${plan.kept} existing value(s) kept.` : ""}
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
