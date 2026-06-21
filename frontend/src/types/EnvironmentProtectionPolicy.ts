/** Bypass policy options for environment protection. */
export type BypassPolicy = "none" | "trusted_token_only";

/**
 * Protection policy for a scoped environment.
 * Controls reviewer approval, self-approval, and trusted-token bypass.
 */
export interface EnvironmentProtectionPolicy {
  protectionId: string;
  environmentId: string;
  requiredReviewers: string[];
  allowSelfApproval: boolean;
  bypassPolicy: BypassPolicy;
  bypassAllowlist: string[];
  createdAt: string;
  updatedAt: string;
}

/** Request body for updating environment protection config. */
export interface EnvironmentProtectionUpdate {
  requiredReviewers?: string[];
  allowSelfApproval?: boolean;
  bypassPolicy?: BypassPolicy;
  bypassAllowlist?: string[];
}
