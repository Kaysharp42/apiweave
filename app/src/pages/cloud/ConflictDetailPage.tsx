import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, GitCompareArrows, GitMerge } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../../components/atoms/Button";
import { Badge } from "../../components/atoms/Badge";
import { Spinner } from "../../components/atoms/Spinner";
import { Card } from "../../components/molecules/Card";
import { ConfirmDialog } from "../../components/molecules/ConfirmDialog";
import { EmptyState } from "../../components/molecules/EmptyState";
import { computeConflictDiff, type ConflictDiffEntry } from "@shared/conflict-diff";
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

// fallow-ignore-next-line complexity -- the page coordinates loading, diffing, field picks, and resolution confirmation
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

  const diff = useMemo<ConflictDiffEntry[]>(() => {
    if (!conflict || !views) return [];
    return computeConflictDiff(conflict.kind, views.local, views.cloud);
  }, [conflict, views]);

  // Overlapping leaf paths the server could not auto-merge — the user must pick a
  // winning side per path. The diff (cloud=before, local=after) supplies the
  // display values; its path scheme matches the server's residual paths.
  const residualPaths = conflict?.merge_residual_paths ?? [];
  const hasResiduals = residualPaths.length > 0;
  // The desktop diff's dotted path notation is kept in lockstep with the
  // server's 3-way merge (see app/shared/conflict-diff/diff.ts), so every
  // server residual path should map to a diff entry. A path with no matching
  // entry means the two diff engines have drifted: surface a warning and block
  // the merge instead of offering a blind "not present" pick for a field we
  // can't display (the FieldPicker below receives only matched entries).
  const { residualEntries, unmatchedPaths } = useMemo<{
    readonly residualEntries: readonly ConflictDiffEntry[];
    readonly unmatchedPaths: readonly string[];
  }>(() => {
    if (!hasResiduals) return { residualEntries: [], unmatchedPaths: [] };
    const byPath = new Map(diff.map((entry) => [entry.path, entry]));
    const matched: ConflictDiffEntry[] = [];
    const unmatched: string[] = [];
    for (const path of residualPaths) {
      const entry = byPath.get(path);
      if (entry === undefined) unmatched.push(path);
      else matched.push(entry);
    }
    return { residualEntries: matched, unmatchedPaths: unmatched };
  }, [hasResiduals, residualPaths, diff]);

  const [picks, setPicks] = useState<Record<string, "local" | "cloud">>({});
  useEffect(() => setPicks({}), [conflictId]);
  const allPicked =
    hasResiduals
    && unmatchedPaths.length === 0
    && residualEntries.every((entry) => picks[entry.path] !== undefined);

  function returnToConflictList(): void {
    if (location.state === "conflict-list") {
      navigate(-1);
      return;
    }
    navigate("/cloud/conflicts", { replace: true });
  }

  // fallow-ignore-next-line complexity -- merged, local, and cloud resolution share one guarded UI action
  async function resolve(
    choice: ConflictWinner,
    resolutions?: readonly { readonly path: string; readonly side: "local" | "cloud" }[],
  ): Promise<void> {
    if (resolving || !conflict) return;
    setResolving(true);
    try {
      await invoke<Conflict>("cloud", "conflict-resolve", {
        conflict_id: conflict.id,
        winner: choice,
        device_id: deviceId || "desktop",
        ...(resolutions && resolutions.length > 0 ? { resolutions } : {}),
      });
      toast.success(choice === "merged" ? "Merged both copies" : `Kept ${choice} copy`);
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
          {conflict.winner === null ? (
            <span className="text-xs text-text-secondary dark:text-text-secondary-dark">
              Cloud edited by {cloudWriterLabel(conflict.cloud_writer)}
            </span>
          ) : null}
        </div>
        {unmatchedPaths.length > 0 && conflict.winner === null ? (
          <ResidualMismatchWarning paths={unmatchedPaths} />
        ) : null}
        {residualEntries.length > 0 && conflict.winner === null ? (
          <FieldPicker entries={residualEntries} picks={picks} onPick={(path, side) => setPicks((prev) => ({ ...prev, [path]: side }))} disabled={disabled} />
        ) : null}
        <DiffView entries={diff} />
        <details className="mt-4 rounded-sm border border-border dark:border-border-dark">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-text-secondary dark:text-text-secondary-dark">
            Technical detail (raw JSON)
          </summary>
          <div className="grid grid-cols-1 gap-4 border-t border-border p-4 dark:border-border-dark xl:grid-cols-2">
            <RecordPane title="Local" payload={views.local} />
            <RecordPane title="Cloud" payload={views.cloud} />
          </div>
        </details>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-raised px-6 py-4 dark:border-border-dark dark:bg-surface-dark-raised">
        {conflict.auto_mergeable && conflict.winner === null ? (
          <Button
            variant="secondary"
            intent="success"
            icon={<GitMerge className="h-4 w-4" aria-hidden="true" />}
            disabled={disabled}
            loading={resolving && pendingChoice === "merged"}
            onClick={() => setPendingChoice("merged")}
          >
            Auto-merge
          </Button>
        ) : hasResiduals && conflict.winner === null ? (
          <Button
            variant="secondary"
            intent="success"
            icon={<GitMerge className="h-4 w-4" aria-hidden="true" />}
            disabled={disabled || !allPicked}
            loading={resolving && pendingChoice === "merged"}
            onClick={() => setPendingChoice("merged")}
          >
            Merge with selections
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
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
      </div>

      <ConfirmDialog
        open={pendingChoice !== null}
        onClose={() => setPendingChoice(null)}
        onConfirm={() => {
          if (!pendingChoice) return;
          if (pendingChoice === "merged" && residualEntries.length > 0) {
            void resolve("merged", residualEntries.map((entry) => ({ path: entry.path, side: picks[entry.path]! })));
          } else {
            void resolve(pendingChoice);
          }
        }}
        title={pendingChoice === "merged" ? "Merge both copies?" : "Resolve whole record?"}
        message={
          pendingChoice === "merged"
            ? residualEntries.length > 0
              ? "Combine both copies into a new cloud revision, using your per-field selections for the overlapping changes and keeping every non-overlapping change from both sides."
              : "Combine both copies into a new cloud revision, keeping every non-overlapping change from local and cloud."
            : `Keep the ${pendingChoice ?? "selected"} copy and store the rejected copy for audit.`
        }
        confirmLabel={pendingChoice === "merged" ? "Merge" : "Resolve conflict"}
        intent={pendingChoice === "merged" ? "info" : "warning"}
      />
    </div>
  );
}

/** "Ada · MacBook Pro", "Ada", or "an unknown author" when unattributed. */
function cloudWriterLabel(writer: Conflict["cloud_writer"]): string {
  if (!writer || (!writer.name && !writer.deviceLabel)) return "an unknown author";
  const name = writer.name || "an unknown author";
  return writer.deviceLabel ? `${name} · ${writer.deviceLabel}` : name;
}

function RecordPane({
  title,
  payload,
}: {
  readonly title: string;
  readonly payload: ConflictPayload;
}) {
  return (
    <Card title={title} icon={ConflictCardIcon} className="h-full">
      <JsonBlock value={payload} label={`${title} record JSON`} />
    </Card>
  );
}

const DIFF_BADGE_VARIANT: Record<ConflictDiffEntry["kind"], "success" | "error" | "warning"> = {
  add: "success",
  remove: "error",
  change: "warning",
};

function DiffView({ entries }: { readonly entries: readonly ConflictDiffEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="rounded-sm border border-border bg-surface-overlay p-4 text-sm text-text-secondary dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-secondary-dark">
        No structural differences — the two copies are equivalent once volatile metadata is ignored.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry) => (
        <li
          key={entry.path}
          className="rounded-sm border border-border bg-surface-overlay p-3 dark:border-border-dark dark:bg-surface-dark-overlay"
        >
          <div className="mb-2 flex items-center gap-2">
            <Badge variant={DIFF_BADGE_VARIANT[entry.kind]} size="sm">{entry.kind}</Badge>
            <span className="text-sm font-medium text-text-primary dark:text-text-primary-dark">{entry.label}</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <DiffValue label="Cloud" value={entry.before} />
            <DiffValue label="Local" value={entry.after} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function DiffValue({ label, value }: { readonly label: string; readonly value: unknown }) {
  if (value === undefined) {
    return (
      <div className="rounded-sm border border-dashed border-border p-2 text-xs text-text-muted dark:border-border-dark">
        <span className="mr-1 font-semibold">{label}:</span>not present
      </div>
    );
  }
  return (
    <pre className="max-h-40 overflow-auto rounded-sm border border-border bg-surface p-2 font-mono text-xs leading-relaxed text-text-primary dark:border-border-dark dark:bg-surface-dark dark:text-text-primary-dark">
      <span className="mr-1 font-semibold not-italic text-text-secondary dark:text-text-secondary-dark">{label}:</span>
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

// Renders when a server residual path has no matching desktop diff entry -- the
// two diff engines have drifted. We refuse a blind "not present" pick and block
// the merge; the keep-local / keep-cloud buttons stay enabled so the conflict is
// resolved as a whole record instead.
function ResidualMismatchWarning({ paths }: { readonly paths: readonly string[] }) {
  return (
    <div className="mb-4 rounded-sm border border-warning/50 bg-warning/5 p-4 dark:border-warning-dark/50">
      <h2 className="text-sm font-semibold text-text-primary dark:text-text-primary-dark">
        Merge unavailable for this conflict
      </h2>
      <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
        The server flagged {paths.length === 1 ? "a field" : `${paths.length} fields`} for per-field picking that this view could not display
        (<span className="font-mono">{paths.join(", ")}</span>). Resolve by keeping the local or cloud copy instead.
      </p>
    </div>
  );
}

// FieldPicker asks the user to choose a winning side for each overlapping leaf
// the server could not auto-merge. Every path must be picked before the merge
// can be submitted (enforced by the caller's `allPicked`; the server re-checks).
function FieldPicker({
  entries,
  picks,
  onPick,
  disabled,
}: {
  readonly entries: readonly ConflictDiffEntry[];
  readonly picks: Record<string, "local" | "cloud">;
  readonly onPick: (path: string, side: "local" | "cloud") => void;
  readonly disabled: boolean;
}) {
  return (
    <div className="mb-4 rounded-sm border border-warning/50 bg-warning/5 p-4 dark:border-warning-dark/50">
      <div className="mb-1 flex items-center gap-2">
        <GitMerge className="h-4 w-4 text-warning dark:text-warning-dark" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-text-primary dark:text-text-primary-dark">
          Choose a version for each conflicting field
        </h2>
      </div>
      <p className="mb-3 text-xs text-text-secondary dark:text-text-secondary-dark">
        Both sides changed these {entries.length === 1 ? "field" : "fields"}. Pick which value to keep; everything else merges automatically.
      </p>
      <ul className="flex flex-col gap-3">
        {entries.map((entry) => (
          <li key={entry.path} className="rounded-sm border border-border bg-surface p-3 dark:border-border-dark dark:bg-surface-dark">
            <div className="mb-2 text-sm font-medium text-text-primary dark:text-text-primary-dark">{entry.label}</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ResidualChoice path={entry.path} side="cloud" value={entry.before} selected={picks[entry.path] === "cloud"} onSelect={onPick} disabled={disabled} />
              <ResidualChoice path={entry.path} side="local" value={entry.after} selected={picks[entry.path] === "local"} onSelect={onPick} disabled={disabled} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResidualChoice({
  path,
  side,
  value,
  selected,
  onSelect,
  disabled,
}: {
  readonly path: string;
  readonly side: "local" | "cloud";
  readonly value: unknown;
  readonly selected: boolean;
  readonly onSelect: (path: string, side: "local" | "cloud") => void;
  readonly disabled: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer flex-col gap-1 rounded-sm border p-2 ${
        selected
          ? "border-primary bg-primary/5 dark:border-primary-dark"
          : "border-border dark:border-border-dark"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <span className="flex items-center gap-2 text-xs font-semibold text-text-secondary dark:text-text-secondary-dark">
        <input
          type="radio"
          name={`pick:${path}`}
          checked={selected}
          disabled={disabled}
          onChange={() => onSelect(path, side)}
        />
        {side === "cloud" ? "Cloud" : "Local"}
      </span>
      <span className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-text-primary dark:text-text-primary-dark">
        {value === undefined ? "not present" : typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </span>
    </label>
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
