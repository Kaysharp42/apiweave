import type { User } from "../../types";
import type { CloudSyncStatus } from "../../types/cloud";
import { getCloudAttention } from "../../utils/cloudAttention";

/**
 * The name + email shown in the account menu. Prefers the linked cloud account
 * so both update after linking; falls back to the local profile otherwise.
 */
export function resolveAccountIdentity(
  user: User,
  status: CloudSyncStatus | null,
): { name: string; email: string; avatarUrl: string | null } {
  const account = status?.linkState === "linked" ? status.account : undefined;
  const cloudName = account?.displayName?.trim();
  const cloudEmail = account?.email?.trim();
  const cloudAvatar = account?.avatarUrl?.trim();

  return {
    name: cloudName || cloudEmail || getAccountDisplayName(user),
    email: cloudEmail || user.verified_email,
    avatarUrl: cloudAvatar || user.avatar_url || null,
  };
}

interface ConnectionBadge {
  readonly label: string;
  readonly className: string;
  readonly dotClassName: string;
}

const MUTED_BADGE =
  "bg-surface-overlay text-text-muted dark:bg-surface-dark-overlay dark:text-text-muted-dark";
const MUTED_DOT = "bg-text-muted dark:bg-text-muted-dark";

const ATTENTION_BADGE: Record<
  "error" | "warning",
  { className: string; dotClassName: string }
> = {
  warning: {
    className:
      "bg-status-warning/10 text-status-warning dark:bg-[var(--aw-status-warning)]/10 dark:text-[var(--aw-status-warning)]",
    dotClassName: "bg-status-warning dark:bg-[var(--aw-status-warning)]",
  },
  error: {
    className:
      "bg-status-error/10 text-status-error dark:bg-[var(--aw-status-error)]/10 dark:text-[var(--aw-status-error)]",
    dotClassName: "bg-status-error dark:bg-[var(--aw-status-error)]",
  },
};

/**
 * Small connection pill next to the role badge. Returns null in web preview
 * (no cloud bridge) or before the first status load.
 *
 * Anything `getCloudAttention` reports wins over the steady-state label: a
 * pill reading "Synced" next to a workspace whose sync is actually paused is
 * worse than no pill at all.
 */
export function getConnectionBadge(
  status: CloudSyncStatus | null,
  unavailable: boolean,
): ConnectionBadge | null {
  if (unavailable || status === null) return null;

  const [attention] = getCloudAttention(status, unavailable);
  if (attention) {
    // Literal strings, not interpolated ones: Tailwind only emits classes it
    // can read verbatim in the source.
    return { label: attention.badgeLabel, ...ATTENTION_BADGE[attention.severity] };
  }

  switch (status.linkState) {
    case "unlinked":
      return {
        label: "Local only",
        className: MUTED_BADGE,
        dotClassName: MUTED_DOT,
      };
    case "linking":
      return { label: "Linking…", className: MUTED_BADGE, dotClassName: MUTED_DOT };
    case "linked":
      return {
        label: status.syncState === "offline" ? "Offline" : "Synced",
        className:
          "bg-status-success/10 text-status-success dark:text-status-success-dark",
        dotClassName: "bg-status-success dark:bg-status-success-dark",
      };
    default:
      return null;
  }
}

export function getAccountDisplayName(user: User): string {
  const trimmedDisplayName = user.display_name?.trim();
  if (trimmedDisplayName) return trimmedDisplayName;

  const emailPrefix = user.verified_email.split("@")[0]?.trim();
  if (emailPrefix) return emailPrefix;

  return user.userId;
}

export function getAccountInitials(user: User, displayName: string): string {
  const source = displayName || user.verified_email;
  if (!source) {
    return (user.userId[0] ?? "U").toUpperCase();
  }

  const initials = source
    .split(/[\s@._-]+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return initials || "U";
}

export function getRoleSummary(user: User): string {
  if (user.roles.includes("admin")) return "Admin · full access";
  if (user.roles.includes("editor")) return "Editor · workflow author";
  if (user.roles.includes("viewer")) return "Viewer · read only";

  if (user.roles.length === 0) return "No role assigned";

  return user.roles
    .map((role) => role.charAt(0).toUpperCase() + role.slice(1))
    .join(" · ");
}
