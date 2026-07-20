import type { BypassPolicy } from "./BypassPolicy";

export interface EnvironmentProtectionUpdate {
  requiredReviewers?: string[];
  allowSelfApproval?: boolean;
  bypassPolicy?: BypassPolicy;
  bypassAllowlist?: string[];
}
