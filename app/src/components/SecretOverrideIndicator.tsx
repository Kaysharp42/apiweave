import { AlertTriangle } from "lucide-react";
import type { SecretOverrideIndicatorProps } from "../types/SecretOverrideIndicatorProps";

const SCOPE_LABELS: Record<string, string> = {
  user: "user",
  organization: "organization",
  workspace: "workspace",
  environment: "environment",
};

/**
 * SecretOverrideIndicator — shows a warning when a secret overrides
 * a same-named secret at a broader scope.
 */
export function SecretOverrideIndicator({
  isOverride,
  overriddenScopeType,
  className = "",
}: SecretOverrideIndicatorProps) {
  if (!isOverride) return null;

  const parentLabel = overriddenScopeType
    ? (SCOPE_LABELS[overriddenScopeType] ?? overriddenScopeType)
    : "parent";

  return (
    <span
      className={[
        "inline-flex items-center gap-1 text-xs text-status-warning",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      title={`This secret overrides a ${parentLabel}-scoped secret with the same name`}
    >
      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
      <span>Overrides {parentLabel}</span>
    </span>
  );
}
