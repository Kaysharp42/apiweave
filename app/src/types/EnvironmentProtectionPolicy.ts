import type { BypassPolicy } from "./BypassPolicy";

export type { BypassPolicy } from "./BypassPolicy";
export type { EnvironmentProtectionUpdate } from "./EnvironmentProtectionUpdate";

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
