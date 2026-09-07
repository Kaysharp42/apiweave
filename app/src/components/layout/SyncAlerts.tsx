import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Lock, ShieldCheck } from "lucide-react";
import { Button } from "../atoms/Button";
import { useCloudSync } from "../../hooks/useCloudSync";
import { useWorkspaceTabs } from "../../hooks/useWorkspaceTabs";
import { invoke } from "../../utils/apiweaveClient";
import type { ConflictListItem } from "../../types/cloud";

/**
 * The Cloud Sync page's blocking warnings, hoisted to the top of the content
 * area so a halted sync interrupts once rather than waiting to be found in a
 * menu. Same shape as `UpdateReadyBanner` directly above it — a full-width
 * strip with one action — in the amber `EncryptionNotice` uses on /cloud/sync.
 *
 * Scoped to what the user is actually looking at, because the counts on
 * `status` are account-wide totals and a problem elsewhere is not an
 * interruption: encryption states to the open workspace, and a conflict to the
 * workflow in the active tab. Everything else still shows in the account menu
 * and on /cloud/sync, which is where you go to see the whole account.
 *
 * `unknown` is deliberately absent: it resolves itself on the next catalog
 * refresh, so it reads as "checking" there and would be noise here.
 */
export function SyncAlerts() {
  const navigate = useNavigate();
  const { status, unavailable } = useCloudSync();
  const { workspaceId, activeTab } = useWorkspaceTabs();

  // `bindings` carries counts, not record ids, so which workflow is in conflict
  // takes the same list the Cloud Sync page reads. Only fetched while a
  // conflict exists, and re-fetched when that total changes.
  const conflictCount = status?.conflictCount ?? 0;
  const [conflicted, setConflicted] = useState<readonly string[]>([]);
  useEffect(() => {
    if (conflictCount === 0) {
      setConflicted([]);
      return;
    }
    let live = true;
    void invoke<readonly ConflictListItem[]>("cloud", "conflict-list", {
      resolved: false,
    })
      .then((items) => {
        if (live) {
          setConflicted(
            items.filter((i) => i.kind === "workflow").map((i) => i.record_id),
          );
        }
      })
      // A banner that cannot name the workflow simply does not appear; the
      // account menu still reports the count.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [conflictCount]);

  if (unavailable || status === null) return null;

  const here = status.bindings.filter((b) => b.workspaceId === workspaceId);

  // Ordered by how hard each one blocks: a locked workspace syncs nothing, a
  // pending choice keeps one out of the cloud, a conflict only awaits a call.
  const alerts = [
    {
      show: here.some((b) => b.encryption === "locked"),
      icon: <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />,
      lead: "This workspace is locked.",
      detail:
        "Sync is paused: it is end-to-end encrypted and locked on this device. Your local data is untouched.",
      action: "Unlock",
      to: "/cloud/sync",
    },
    {
      show: status.encryptionDecisionPending.some(
        (d) => d.workspaceId === workspaceId,
      ),
      icon: <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />,
      lead: "This workspace is waiting on an encryption choice.",
      detail: "It is not in the cloud yet, and the choice is permanent.",
      action: "Choose",
      to: "/cloud/sync",
    },
    {
      show:
        activeTab !== undefined && conflicted.includes(activeTab.workflowId),
      icon: <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />,
      lead: "This workflow has a sync conflict.",
      detail: "Local and cloud edits disagree. Review it to resume syncing.",
      action: "Resolve",
      to: "/cloud/conflicts",
    },
  ].filter((alert) => alert.show);

  if (alerts.length === 0) return null;

  return (
    <>
      {alerts.map((alert) => (
        <div
          key={alert.action}
          role="status"
          className="flex w-full min-w-0 items-center gap-3 border-b border-status-warning/30 bg-status-warning/10 px-4 py-2 dark:border-[var(--aw-status-warning)]/30 dark:bg-[var(--aw-status-warning)]/10"
        >
          <span className="text-status-warning dark:text-[var(--aw-status-warning)]">
            {alert.icon}
          </span>

          {/* One line, truncated: the banner must not grow taller as the
              window narrows — it steals height from the canvas below it, and
              the detail only restates the button next to it. */}
          <span className="min-w-0 flex-1 truncate text-xs text-text-primary dark:text-text-primary-dark">
            <span className="font-medium">{alert.lead}</span>{" "}
            <span className="text-text-secondary dark:text-text-secondary-dark">
              {alert.detail}
            </span>
          </span>

          <Button
            variant="primary"
            size="xs"
            className="shrink-0"
            onClick={() => navigate(alert.to)}
          >
            {alert.action}
          </Button>
        </div>
      ))}
    </>
  );
}
