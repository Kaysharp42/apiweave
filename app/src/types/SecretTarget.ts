import type { Secret } from "./Secret";

/** A secret plus the workspace whose scope holds it — the pair every action needs. */
export interface SecretTarget {
  readonly secret: Secret;
  readonly workspaceId: string;
}
