export interface ProtectionFormState {
  requiredReviewers: string[];
  allowSelfApproval: boolean;
  bypassPolicy: "none" | "trusted_token_only";
  bypassAllowlist: string[];
}
