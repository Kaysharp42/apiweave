export const DefaultCollectionColor = "var(--aw-status-info)";

export const PresetCollectionColors = [
  "var(--aw-status-info)",
  "var(--aw-status-error)",
  "var(--aw-status-success)",
  "var(--aw-status-warning)",
  "var(--aw-primary)",
  "var(--aw-primary-light)",
  // Was --aw-status-running. Kept off the row deliberately: running is amber
  // and sits next to `warning` here, which is close enough in a 20px swatch to
  // be a coin toss. A collection colour is a label, not a status.
  "var(--aw-branch-edge)",
  "var(--aw-text-secondary)",
  "var(--aw-text-muted)",
  "var(--aw-primary-hover)",
] as const;
