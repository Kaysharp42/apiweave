import type { EnvironmentProtectionPolicy } from "./EnvironmentProtectionPolicy";
import type { ReviewerOption } from "./ReviewerSelectorProps";

export interface EnvironmentProtectionPanelProps {
  /** The environment ID this protection applies to. */
  environmentId: string;
  /** Current protection config, or null if unprotected. */
  protection: EnvironmentProtectionPolicy | null;
  /** Available reviewer options. */
  reviewerOptions: ReviewerOption[];
  /** Called when protection config is saved. */
  onSave: (update: ProtectionFormState) => void | Promise<void>;
  /** Called when protection is removed. */
  onRemove: () => void | Promise<void>;
  /** Whether a save/remove is in progress. */
  saving?: boolean;
  className?: string;
}

export interface ProtectionFormState {
  requiredReviewers: string[];
  allowSelfApproval: boolean;
  bypassPolicy: "none" | "trusted_token_only";
  bypassAllowlist: string[];
}
