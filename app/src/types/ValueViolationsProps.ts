import type { SchemaViolation } from "@shared/types/SchemaViolation";

export interface ValueViolationsProps {
  /** Accessible name of the list: "Snapshot differences", "Schema violations". */
  label: string;
  /** Where the value broke the rule, and why. Nothing renders when empty. */
  violations: readonly SchemaViolation[];
  className?: string;
}
