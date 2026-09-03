/**
 * Frame tints, as design tokens rather than hex.
 *
 * A frame's colour is persisted (`config.color`), so it has to survive a theme
 * switch — a stored `#64748b` would be a light-mode grey burned into a dark
 * canvas. The name is what persists; the token is what renders.
 */
export const GROUP_TINTS = {
  slate: "var(--aw-text-muted)",
  blue: "var(--aw-status-info)",
  green: "var(--aw-status-success)",
  amber: "var(--aw-status-warning)",
  violet: "var(--aw-branch-edge)",
  rose: "var(--aw-status-error)",
} as const;

export type GroupTint = keyof typeof GROUP_TINTS;
