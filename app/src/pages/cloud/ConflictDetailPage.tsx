import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Cloud,
  GitCompareArrows,
  GitMerge,
  Laptop,
} from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../../components/atoms/Button";
import { Badge } from "../../components/atoms/Badge";
import { Spinner } from "../../components/atoms/Spinner";
import { Card } from "../../components/molecules/Card";
import { ConfirmDialog } from "../../components/molecules/ConfirmDialog";
import { EmptyState } from "../../components/molecules/EmptyState";
import { computeConflictDiff, type ConflictDiffEntry, type ConflictDiffKind } from "@shared/conflict-diff";
import { invoke, IpcError } from "../../utils/apiweaveClient";
import type {
  Conflict,
  ConflictPayload,
  ConflictWinner,
  CloudSyncStatus,
} from "../../types/cloud";

type PendingChoice = ConflictWinner | null;
type Side = "local" | "cloud";

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
  // can't display (the merge workspace receives only matched entries).
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

  const [picks, setPicks] = useState<Record<string, Side>>({});
  useEffect(() => setPicks({}), [conflictId]);
  const allPicked =
    hasResiduals
    && unmatchedPaths.length === 0
    && residualEntries.every((entry) => picks[entry.path] !== undefined);

  function acceptAll(side: Side): void {
    const next: Record<string, Side> = {};
    for (const entry of residualEntries) next[entry.path] = side;
    setPicks(next);
  }

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
        defer_push: true,
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
        <div className="flex items-center gap-2">
          <Badge variant="secondary" size="sm">Not pushed</Badge>
          {error && <Badge variant="warning">{error}</Badge>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 lg:p-6">
        {unmatchedPaths.length > 0 && conflict.winner === null ? (
          <ResidualMismatchWarning paths={unmatchedPaths} />
        ) : null}
        <MergeWorkspace
          entries={diff}
          residualPaths={residualPaths}
          picks={picks}
          cloudRev={conflict.cloud_rev}
          localRev={conflict.local_rev}
          cloudWriter={cloudWriterLabel(conflict.cloud_writer)}
          mergeAvailable={
            conflict.winner === null
            && unmatchedPaths.length === 0
            && (Boolean(conflict.auto_mergeable) || hasResiduals)
          }
          disabled={disabled}
          onPick={(path, side) => setPicks((prev) => ({ ...prev, [path]: side }))}
          onAcceptAll={acceptAll}
        />
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

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-raised px-4 py-3 dark:border-border-dark dark:bg-surface-dark-raised lg:px-6">
        <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
          Applies to your workspace only — use the Cloud Sync page to push when ready.
        </p>
        <div className="flex flex-wrap gap-2">
          {conflict.auto_mergeable && conflict.winner === null ? (
            <Button
              variant="secondary"
              intent="success"
              icon={<GitMerge className="h-4 w-4" aria-hidden="true" />}
              disabled={disabled}
              loading={resolving && pendingChoice === "merged"}
              onClick={() => setPendingChoice("merged")}
            >
              Apply merge to workspace
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
              Apply merge to workspace
            </Button>
          ) : (
            <span />
          )}
          <Button
            variant="secondary"
            intent="warning"
            disabled={disabled}
            loading={resolving && pendingChoice === "local"}
            onClick={() => setPendingChoice("local")}
          >
            Keep Local copy
          </Button>
          <Button
            variant="secondary"
            disabled={disabled}
            loading={resolving && pendingChoice === "cloud"}
            onClick={() => setPendingChoice("cloud")}
          >
            Keep Cloud copy
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
        title={pendingChoice === "merged" ? "Apply merge to workspace?" : "Resolve whole record?"}
        message={
          pendingChoice === "merged"
            ? residualEntries.length > 0
              ? "Combine both copies into your local workspace, using your per-field selections for the overlapping changes and keeping every non-overlapping change from both sides. This does not push to cloud — sync from the Cloud Sync page when ready."
              : "Combine both copies into your local workspace, keeping every non-overlapping change from local and cloud. This does not push to cloud — sync from the Cloud Sync page when ready."
            : `Keep the ${pendingChoice ?? "selected"} copy in your local workspace and store the rejected copy for audit. This does not push to cloud.`
        }
        confirmLabel={pendingChoice === "merged" ? "Apply to workspace" : "Resolve conflict"}
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

// Diff-kind → status color token, used for the row's diff accent stripe and badge.
const DIFF_KIND_ACCENT: Record<ConflictDiffKind, "success" | "error" | "warning"> = {
  add: "success",
  remove: "error",
  change: "warning",
};

function MergeWorkspace({
  entries,
  residualPaths,
  picks,
  cloudRev,
  localRev,
  cloudWriter,
  mergeAvailable,
  disabled,
  onPick,
  onAcceptAll,
}: {
  readonly entries: readonly ConflictDiffEntry[];
  readonly residualPaths: readonly string[];
  readonly picks: Record<string, Side>;
  readonly cloudRev: number;
  readonly localRev: number;
  readonly cloudWriter: string;
  readonly mergeAvailable: boolean;
  readonly disabled: boolean;
  readonly onPick: (path: string, side: Side) => void;
  readonly onAcceptAll: (side: Side) => void;
}) {
  if (entries.length === 0) {
    return (
      <p className="rounded-sm border border-border bg-surface-overlay p-4 text-sm text-text-secondary dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-secondary-dark">
        No structural differences — the two copies are equivalent once volatile metadata is ignored.
      </p>
    );
  }
  const residualSet = new Set(residualPaths);
  const pickedCount = residualPaths.filter((path) => picks[path] !== undefined).length;
  const unresolvedCount = residualPaths.length - pickedCount;

  return (
    <section aria-labelledby="merge-workspace-heading">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="merge-workspace-heading" className="text-sm font-semibold text-text-primary dark:text-text-primary-dark">
            Merge changes
          </h2>
          <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
            Use the arrows to pull each change into the center result. The result applies to your workspace only.
          </p>
        </div>
        {residualPaths.length > 0 ? (
          <Badge variant={unresolvedCount === 0 ? "success" : "warning"}>
            {unresolvedCount === 0
              ? `${pickedCount} resolved`
              : `${unresolvedCount} unresolved`}
          </Badge>
        ) : mergeAvailable ? (
          <Badge variant="success"><Check className="h-3 w-3" aria-hidden="true" />ready to merge</Badge>
        ) : (
          <Badge variant="warning">whole-record choice</Badge>
        )}
      </div>

      <div className="overflow-hidden rounded-sm border border-border bg-surface-raised dark:border-border-dark dark:bg-surface-dark-raised" data-testid="conflict-merge-workspace">
        {/* IntelliJ-style three-pane header: Cloud | Result | Local */}
        <div className="hidden grid-cols-3 border-b border-border bg-surface-overlay dark:border-border-dark dark:bg-surface-dark-overlay lg:grid">
          <MergePaneHeader
            icon={<Cloud className="h-4 w-4" aria-hidden="true" />}
            title="Cloud copy"
            subtitle={`Incoming · revision ${cloudRev} · ${cloudWriter}`}
            action={residualPaths.length > 0 ? (
              <Button size="xs" variant="ghost" disabled={disabled} onClick={() => onAcceptAll("cloud")}>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /> Accept all
              </Button>
            ) : null}
            accent="info"
          />
          <MergePaneHeader
            icon={<GitMerge className="h-4 w-4" aria-hidden="true" />}
            title="Merge result"
            subtitle={mergeAvailable ? "Workspace copy after apply" : "Choose one complete copy"}
            result
          />
          <MergePaneHeader
            icon={<Laptop className="h-4 w-4" aria-hidden="true" />}
            title="Local copy"
            subtitle={`Current device · revision ${localRev}`}
            action={residualPaths.length > 0 ? (
              <Button size="xs" variant="ghost" disabled={disabled} onClick={() => onAcceptAll("local")}>
                Accept all <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            ) : null}
            accent="primary"
          />
        </div>

        <ul>
          {entries.map((entry) => {
            const residual = residualSet.has(entry.path);
            const selectedSide = picks[entry.path];
            return (
              <li key={entry.path} className="border-b border-border last:border-b-0 dark:border-border-dark">
                <div className="flex min-w-0 flex-wrap items-center gap-2 bg-surface-overlay/70 px-3 py-2 dark:bg-surface-dark-overlay/70">
                  <Badge variant={DIFF_KIND_ACCENT[entry.kind]} size="sm">{entry.kind}</Badge>
                  <span className="text-xs font-semibold text-text-primary dark:text-text-primary-dark">{entry.label}</span>
                  <code className="min-w-0 break-all text-[10px] text-text-muted dark:text-text-muted-dark">{entry.path}</code>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 lg:divide-x lg:divide-border lg:dark:divide-border-dark">
                  {/* Cloud (left) */}
                  <MergeSourceCell
                    label="Cloud copy"
                    value={entry.before}
                    kind={entry.kind}
                    source="cloud"
                    residual={residual}
                    selected={selectedSide === "cloud"}
                    disabled={disabled}
                    onPick={onPick}
                    entry={entry}
                  />
                  {/* Merge result (center) */}
                  <MergeResultCell
                    entry={entry}
                    residual={residual}
                    selectedSide={selectedSide}
                    mergeAvailable={mergeAvailable}
                  />
                  {/* Local (right) */}
                  <MergeSourceCell
                    label="Local copy"
                    value={entry.after}
                    kind={entry.kind}
                    source="local"
                    residual={residual}
                    selected={selectedSide === "local"}
                    disabled={disabled}
                    onPick={onPick}
                    entry={entry}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function MergePaneHeader({
  icon,
  title,
  subtitle,
  action,
  result = false,
  accent,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly subtitle: string;
  readonly action?: ReactNode;
  readonly result?: boolean;
  readonly accent?: "info" | "primary";
}) {
  return (
    <div className={`flex min-w-0 items-center justify-between gap-2 px-3 py-2.5 ${result ? "bg-primary/5" : ""} ${accent === "info" ? "border-l-2 border-status-info dark:border-[var(--aw-status-info)]" : accent === "primary" ? "border-l-2 border-primary dark:border-primary-light" : ""}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-xs font-semibold text-text-primary dark:text-text-primary-dark">
          {icon}{title}
        </div>
        <p className="mt-0.5 truncate text-[10px] text-text-secondary dark:text-text-secondary-dark">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function MergeSourceAcceptButton({
  source,
  selected,
  disabled,
  entry,
  onPick,
}: {
  readonly source: Side;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly entry: ConflictDiffEntry;
  readonly onPick: (path: string, side: Side) => void;
}) {
  return (
    <Button
      size="xs"
      variant={selected ? "secondary" : "ghost"}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`Accept ${source === "cloud" ? "Cloud" : "Local"} for ${entry.label}`}
      icon={
        source === "cloud"
          ? <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          : <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
      }
      onClick={() => onPick(entry.path, source)}
    >
      {selected ? "Accepted" : "Accept"}
    </Button>
  );
}

// A read-only source pane (Cloud or Local). When the entry is a residual the
// user must pick, the cell hosts a chevron button that pulls its value into
// the center result — IntelliJ's accept-this-change arrow.
function MergeSourceCell({
  label,
  value,
  kind,
  source,
  residual,
  selected,
  disabled,
  onPick,
  entry,
}: {
  readonly label: string;
  readonly value: unknown;
  readonly kind: ConflictDiffKind;
  readonly source: Side;
  readonly residual: boolean;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onPick: (path: string, side: Side) => void;
  readonly entry: ConflictDiffEntry;
}) {
  // Color-tint the source cell by diff kind so the source of the change is
  // legible at a glance, exactly as IntelliJ shades added/removed/changed lines.
  const tint =
    kind === "add"
      ? "bg-status-success/5 dark:bg-[var(--aw-status-success)]/5"
      : kind === "remove"
        ? "bg-status-error/5 dark:bg-[var(--aw-status-error)]/5"
        : "";
  const isSelectedTint = selected
    ? "ring-1 ring-inset ring-status-success/40 dark:ring-[var(--aw-status-success)]/40"
    : "";

  return (
    <div className={`min-h-24 min-w-0 p-3 ${tint} ${isSelectedTint} bg-surface-raised dark:bg-surface-dark-raised`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary dark:text-text-secondary-dark lg:hidden">{label}</p>
        {residual ? (
          <MergeSourceAcceptButton
            source={source}
            selected={selected}
            disabled={disabled}
            entry={entry}
            onPick={onPick}
          />
        ) : null}
      </div>
      <ConflictValue value={value} />
    </div>
  );
}

function MergeResultCell({
  entry,
  residual,
  selectedSide,
  mergeAvailable,
}: {
  readonly entry: ConflictDiffEntry;
  readonly residual: boolean;
  readonly selectedSide: Side | undefined;
  readonly mergeAvailable: boolean;
}) {
  const selectedValue = selectedSide === "cloud" ? entry.before : selectedSide === "local" ? entry.after : undefined;

  return (
    <div className="min-h-24 min-w-0 border-y border-border bg-primary/5 p-3 dark:border-border-dark lg:border-y-0">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-secondary dark:text-text-secondary-dark lg:hidden">Merge result</p>
      {residual ? (
        <div className="grid gap-2">
          {selectedSide ? (
            <div>
              <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-status-success dark:text-[var(--aw-status-success)]">
                <Check className="h-3 w-3" aria-hidden="true" />Accepted {selectedSide}
              </p>
              <ConflictValue value={selectedValue} />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-status-warning dark:text-[var(--aw-status-warning)]">Pick a side using the arrows ←</span>
            </div>
          )}
        </div>
      ) : mergeAvailable ? (
        <div className="flex gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-success dark:text-[var(--aw-status-success)]" aria-hidden="true" />
          <span><strong className="font-semibold text-text-primary dark:text-text-primary-dark">Included automatically.</strong> The server preserves the side changed from the common base.</span>
        </div>
      ) : (
        <div className="flex gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
          <GitCompareArrows className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span><strong className="font-semibold text-text-primary dark:text-text-primary-dark">Whole-record decision.</strong> Keep the complete Cloud or Local copy below.</span>
        </div>
      )}
    </div>
  );
}

function ConflictValue({ value }: { readonly value: unknown }) {
  if (value === undefined) {
    return (
      <span className="inline-flex rounded-sm border border-dashed border-border px-2 py-1 text-xs text-text-muted dark:border-border-dark dark:text-text-muted-dark">
        Not present
      </span>
    );
  }
  return (
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-text-primary dark:text-text-primary-dark">
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
