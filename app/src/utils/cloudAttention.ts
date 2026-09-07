import type { CloudSyncStatus } from "../types/cloud";

/**
 * The cloud states that are the user's problem to fix, derived once and read by
 * every surface that announces them (the shell banner, the avatar dot, the
 * account-menu pill and section). One derivation, so the dot can never disagree
 * with the banner about whether something needs attention.
 */
export type CloudAttentionKind =
  | "authRequired"
  | "locked"
  | "conflicts"
  | "encryptionChoice"
  | "error";

export interface CloudAttentionItem {
  readonly kind: CloudAttentionKind;
  /** Headline: what is wrong. */
  readonly title: string;
  /** One sentence: the consequence, and what the action does about it. */
  readonly detail: string;
  readonly actionLabel: string;
  /** Where the action goes when a surface can't handle it in place. */
  readonly route: string;
  /** Short label for the connection pill and the dot's accessible name. */
  readonly badgeLabel: string;
  /** Whose passphrase / choice is missing — empty for the other kinds. */
  readonly workspaces: readonly { readonly id: string; readonly name: string }[];
  readonly severity: "error" | "warning";
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * Ordered worst-first. `unknown` encryption is deliberately absent: it means
 * "still checking with the cloud", resolves itself on the next catalog refresh,
 * and is never something the user acts on.
 */
export function getCloudAttention(
  status: CloudSyncStatus | null,
  unavailable = false,
): readonly CloudAttentionItem[] {
  if (unavailable || status === null) return [];

  // Signed out of the cloud: everything below is downstream of this, so it is
  // the only thing worth saying.
  if (status.linkState === "authenticationRequired") {
    return [
      {
        kind: "authRequired",
        title: "Cloud sign-in needed",
        detail:
          "Your cloud session expired, so nothing is syncing. Sign in again to resume — your local data is untouched.",
        actionLabel: "Sign in again",
        route: "/cloud/sync",
        badgeLabel: "Sign-in needed",
        workspaces: [],
        severity: "error",
      },
    ];
  }

  if (status.linkState !== "linked") return [];

  const items: CloudAttentionItem[] = [];

  const locked = status.bindings.filter(
    (binding) => binding.encryption === "locked",
  );
  if (locked.length > 0) {
    const names = locked.map((binding) => ({
      id: binding.workspaceId,
      name: binding.workspaceName,
    }));
    const firstName = names[0]?.name ?? "";
    items.push({
      kind: "locked",
      title:
        locked.length === 1
          ? `“${firstName}” is locked`
          : `${locked.length} workspaces are locked`,
      detail:
        locked.length === 1
          ? "It is end-to-end encrypted and sync is paused until you enter its passphrase on this device. Your local data is untouched."
          : "They are end-to-end encrypted and sync is paused until you enter each passphrase on this device. Your local data is untouched.",
      actionLabel: locked.length === 1 ? "Unlock workspace" : "Unlock workspaces",
      route: "/cloud/sync",
      badgeLabel: "Locked",
      workspaces: names,
      severity: "warning",
    });
  }

  if (status.conflictCount > 0) {
    items.push({
      kind: "conflicts",
      title: `${status.conflictCount} sync ${plural(status.conflictCount, "conflict needs", "conflicts need")} your review`,
      detail:
        "The same item changed in two places. Pick which version wins — nothing syncs past a conflict until you do.",
      actionLabel: "Resolve conflicts",
      route: "/cloud/conflicts",
      badgeLabel: plural(status.conflictCount, "1 conflict", `${status.conflictCount} conflicts`),
      workspaces: [],
      severity: "warning",
    });
  }

  const pending = status.encryptionDecisionPending;
  if (pending.length > 0) {
    items.push({
      kind: "encryptionChoice",
      title:
        pending.length === 1
          ? `“${pending[0]?.workspaceName ?? ""}” isn't syncing yet`
          : `${pending.length} workspaces aren't syncing yet`,
      detail:
        "Waiting on a one-time choice: encrypt end-to-end with a passphrase, or sync without encryption. Both answers are permanent.",
      actionLabel: "Choose encryption",
      route: "/cloud/sync",
      badgeLabel: "Choice needed",
      workspaces: pending.map((decision) => ({
        id: decision.workspaceId,
        name: decision.workspaceName,
      })),
      severity: "warning",
    });
  }

  if (
    status.syncState === "error" ||
    status.deadLetterCount > 0 ||
    status.lastError
  ) {
    items.push({
      kind: "error",
      title: "Sync stopped with an error",
      detail: status.lastError ?? "Open Cloud Sync to see what failed and retry.",
      actionLabel: "Open Cloud Sync",
      route: "/cloud/sync",
      badgeLabel: "Sync error",
      workspaces: [],
      severity: "error",
    });
  }

  return items;
}

/**
 * Stable identity for the set of problems on screen. A dismissal is keyed by
 * this, so getting rid of the banner for one problem never hides the next one.
 */
export function cloudAttentionSignature(
  items: readonly CloudAttentionItem[],
): string {
  return items
    .map((item) => `${item.kind}:${item.title}:${item.workspaces.map((w) => w.id).join(",")}`)
    .join("|");
}
