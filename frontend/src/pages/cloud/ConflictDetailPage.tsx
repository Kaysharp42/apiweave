import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, GitCompareArrows } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../../components/atoms/Button";
import { Badge } from "../../components/atoms/Badge";
import { Spinner } from "../../components/atoms/Spinner";
import { Card } from "../../components/molecules/Card";
import { ConfirmDialog } from "../../components/molecules/ConfirmDialog";
import { EmptyState } from "../../components/molecules/EmptyState";
import { WorkflowProvider } from "../../contexts/WorkflowContext";
import { invoke, IpcError } from "../../utils/apiweaveClient";
import type {
  Conflict,
  ConflictPayload,
  ConflictWinner,
  CloudSyncStatus,
} from "../../types/cloud";

type PendingChoice = ConflictWinner | null;

function ConflictCardIcon({ className }: { readonly className?: string }) {
  return <GitCompareArrows className={className} />;
}

export function redactEnvironmentPayload(
  payload: ConflictPayload,
  environmentId: string,
): ConflictPayload {
  const secrets = payload["secrets"];
  if (secrets === undefined) return payload;
  const redactedSecrets = Array.isArray(secrets)
    ? secrets.map((entry) => redactSecretEntry(entry, environmentId))
    : Object.keys(asRecord(secrets)).map((name) => ({
        name: "<SECRET>",
        reference: `environment:${environmentId}:${name}`,
      }));
  return { ...payload, secrets: redactedSecrets };
}

export function ConflictDetailPage() {
  const { conflictId = "" } = useParams<{ conflictId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingChoice, setPendingChoice] = useState<PendingChoice>(null);
  const [resolving, setResolving] = useState(false);
  const [deviceId, setDeviceId] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const item = await invoke<Conflict>("cloud", "conflict-get", {
        conflict_id: conflictId,
      });
      setConflict(item);
      setError(item.winner ? "Conflict already resolved" : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conflict");
    } finally {
      setLoading(false);
    }
  }, [conflictId]);

  // The real device id (this device's registered cloud identity). The main
  // process authorizes with its own token-store device id regardless, but the
  // bridge requires a non-empty value, so we source the persisted one.
  useEffect(() => {
    void invoke<CloudSyncStatus>("cloud", "status", {})
      .then((status) => setDeviceId(status.deviceId ?? ""))
      .catch(() => setDeviceId(""));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const views = useMemo(() => {
    if (!conflict) return null;
    return {
      local:
        conflict.kind === "environment"
          ? redactEnvironmentPayload(conflict.local_payload, conflict.record_id)
          : conflict.local_payload,
      cloud:
        conflict.kind === "environment"
          ? redactEnvironmentPayload(conflict.cloud_payload, conflict.record_id)
          : conflict.cloud_payload,
    };
  }, [conflict]);

  function returnToConflictList(): void {
    if (location.state === "conflict-list") {
      navigate(-1);
      return;
    }
    navigate("/cloud/conflicts", { replace: true });
  }

  async function resolve(choice: ConflictWinner): Promise<void> {
    if (resolving || !conflict) return;
    setResolving(true);
    try {
      await invoke<Conflict>("cloud", "conflict-resolve", {
        conflict_id: conflict.id,
        winner: choice,
        device_id: deviceId || "desktop",
      });
      toast.success(`Kept ${choice} copy`);
      returnToConflictList();
    } catch (err) {
      const message =
        err instanceof IpcError && err.code === "conflict"
          ? "Conflict already resolved"
          : err instanceof Error
            ? err.message
            : "Failed to resolve conflict";
      toast.error(message);
      setError(message);
    } finally {
      setResolving(false);
      setPendingChoice(null);
    }
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Spinner size="lg" /></div>;
  }

  if (!conflict || !views) {
    return (
      <EmptyState
        icon={<GitCompareArrows className="h-12 w-12 text-text-muted" strokeWidth={1.5} />}
        title="Conflict unavailable"
        description={error ?? "This conflict could not be loaded."}
      />
    );
  }

  const disabled = resolving || conflict.winner !== null;

  return (
    <div className="flex h-full flex-col bg-surface dark:bg-surface-dark">
      <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4 dark:border-border-dark">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
            onClick={returnToConflictList}
          >
            Back
          </Button>
          <div>
            <h1 className="text-xl font-semibold text-text-primary dark:text-text-primary-dark">
              Resolve conflict
            </h1>
            <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
              {conflict.kind} · {conflict.name ?? <span className="font-mono">{conflict.record_id}</span>}
            </p>
          </div>
        </div>
        {error && <Badge variant="warning">{error}</Badge>}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">local rev {conflict.local_rev}</Badge>
          <Badge variant="secondary">cloud rev {conflict.cloud_rev}</Badge>
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <RecordPane title="Local" payload={views.local} conflict={conflict} />
          <RecordPane title="Cloud" payload={views.cloud} conflict={conflict} />
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border bg-surface-raised px-6 py-4 dark:border-border-dark dark:bg-surface-dark-raised">
        <Button
          variant="secondary"
          intent="warning"
          disabled={disabled}
          loading={resolving && pendingChoice === "local"}
          onClick={() => setPendingChoice("local")}
        >
          Keep local
        </Button>
        <Button
          variant="primary"
          disabled={disabled}
          loading={resolving && pendingChoice === "cloud"}
          onClick={() => setPendingChoice("cloud")}
        >
          Keep cloud
        </Button>
      </div>

      <ConfirmDialog
        open={pendingChoice !== null}
        onClose={() => setPendingChoice(null)}
        onConfirm={() => {
          if (pendingChoice) void resolve(pendingChoice);
        }}
        title="Resolve whole record?"
        message={`Keep the ${pendingChoice ?? "selected"} copy and store the rejected copy for audit.`}
        confirmLabel="Resolve conflict"
        intent="warning"
      />
    </div>
  );
}

function RecordPane({
  title,
  payload,
  conflict,
}: {
  readonly title: string;
  readonly payload: ConflictPayload;
  readonly conflict: Conflict;
}) {
  return (
    <Card title={title} icon={ConflictCardIcon} className="h-full">
      {conflict.kind === "workflow" ? (
        <WorkflowProvider workflowId={conflict.record_id} initialWorkflow={payload}>
          <JsonBlock value={payload} label={`${title} workflow definition`} />
        </WorkflowProvider>
      ) : (
        <JsonBlock value={payload} label={`${title} record JSON`} />
      )}
    </Card>
  );
}

function JsonBlock({ value, label }: { readonly value: unknown; readonly label: string }) {
  return (
    <pre
      aria-label={label}
      className="max-h-[60vh] overflow-auto rounded-sm border border-border bg-surface-overlay p-3 font-mono text-xs leading-relaxed text-text-primary dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-primary-dark"
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function redactSecretEntry(value: unknown, environmentId: string): { readonly name: string; readonly reference: string } {
  const entry = asRecord(value);
  const ref = typeof entry["reference"] === "string" ? entry["reference"] : "";
  const name = typeof entry["name"] === "string" ? entry["name"] : ref.split(":").pop() || "secret";
  return { name: "<SECRET>", reference: ref || `environment:${environmentId}:${name}` };
}
