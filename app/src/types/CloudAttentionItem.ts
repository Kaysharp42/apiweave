import type { CloudAttentionKind } from "./CloudAttentionKind";

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
