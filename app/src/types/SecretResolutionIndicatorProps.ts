import type { ResolvedSecretInfo } from "@shared/types/ResolvedSecretInfo";

export interface SecretResolutionIndicatorProps {
  /** Secret names referenced by this node's config. */
  secretRefs: readonly string[];
  /** Run-level resolution metadata (name/scope/resolved). */
  resolvedSecrets?: readonly ResolvedSecretInfo[] | undefined;
}