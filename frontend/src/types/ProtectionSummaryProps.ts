import type { EnvironmentProtectionPolicy } from "./EnvironmentProtectionPolicy";

export interface ProtectionSummaryProps {
  /** Protection config to summarize. */
  protection: EnvironmentProtectionPolicy | null;
  /** Called when the user wants to edit protection settings. */
  onEdit: () => void;
  className?: string;
}
