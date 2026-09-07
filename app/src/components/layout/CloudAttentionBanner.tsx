import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CloudOff,
  GitCompareArrows,
  Lock,
  ShieldAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "../atoms/Button";
import { useCloudSync } from "../../hooks/useCloudSync";
import { WorkspaceEncryptionDialog } from "../../pages/cloud/WorkspaceEncryptionDialog";
import {
  cloudAttentionSignature,
  getCloudAttention,
  type CloudAttentionItem,
} from "../../utils/cloudAttention";

const ICONS: Record<CloudAttentionItem["kind"], typeof Lock> = {
  authRequired: AlertTriangle,
  locked: Lock,
  conflicts: GitCompareArrows,
  encryptionChoice: ShieldAlert,
  error: CloudOff,
};

const TONES: Record<CloudAttentionItem["severity"], string> = {
  warning:
    "border-status-warning/30 bg-status-warning/10 text-status-warning dark:border-[var(--aw-status-warning)]/30 dark:bg-[var(--aw-status-warning)]/10 dark:text-[var(--aw-status-warning)]",
  error:
    "border-status-error/30 bg-status-error/10 text-status-error dark:border-[var(--aw-status-error)]/30 dark:bg-[var(--aw-status-error)]/10 dark:text-[var(--aw-status-error)]",
};

/**
 * The shell-level announcement for a cloud state the user has to fix. It exists
 * because the two states that stop sync dead — a locked workspace and an
 * unresolved conflict — were only visible three clicks deep on /cloud/sync,
 * which is not a place anyone looks unprompted.
 *
 * One item at a time (the worst one), with a count of the rest, so the shell
 * never turns into a stack of bars. Dismissal is in-memory and keyed by the
 * exact set of problems: it clears this session's noise, a new problem re-earns
 * the interruption, and the avatar dot stays lit either way.
 */
export function CloudAttentionBanner() {
  const cloud = useCloudSync();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [unlockFor, setUnlockFor] = useState<{ id: string; name: string } | null>(
    null,
  );

  const items = getCloudAttention(cloud.status, cloud.unavailable);
  const signature = cloudAttentionSignature(items);
  const top = items[0];

  if (!top || signature === dismissed) return null;

  const Icon = ICONS[top.kind];

  // A single locked workspace is one passphrase away from fixed — ask here
  // rather than sending the user to the page that owns the same dialog.
  const inlineUnlock =
    top.kind === "locked" && top.workspaces.length === 1
      ? top.workspaces[0]
      : null;

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2 ${TONES[top.severity]}`}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />

        <span className="min-w-0 flex-1 text-xs">
          <span className="font-medium">{top.title}</span>{" "}
          <span className="text-text-secondary dark:text-text-secondary-dark">
            {top.detail}
          </span>
        </span>

        {items.length > 1 && (
          <button
            type="button"
            onClick={() => navigate("/cloud/sync")}
            className="shrink-0 cursor-pointer text-xs underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 dark:focus-visible:outline-primary-light"
          >
            +{items.length - 1} more
          </button>
        )}

        <Button
          variant="primary"
          size="xs"
          loading={cloud.busy}
          onClick={() =>
            inlineUnlock ? setUnlockFor(inlineUnlock) : navigate(top.route)
          }
        >
          {top.actionLabel}
        </Button>

        <Button
          variant="ghost"
          size="xs"
          onClick={() => setDismissed(signature)}
          icon={<X className="h-3 w-3" />}
          aria-label="Dismiss this notice — it stays in the account menu"
        >
          Later
        </Button>
      </div>

      <WorkspaceEncryptionDialog
        open={unlockFor !== null}
        mode="unlock"
        workspaceName={unlockFor?.name ?? ""}
        busy={cloud.busy}
        onClose={() => setUnlockFor(null)}
        onSubmit={async (passphrase) => {
          if (!unlockFor) return;
          const next = await cloud.unlockWorkspace(unlockFor.id, passphrase);
          toast.success("Workspace unlocked — sync resumed");
          return next;
        }}
      />
    </>
  );
}
