import { Badge } from "./atoms/Badge";
import type { ScopeBadgeProps } from "../types/ScopeBadgeProps";

const SCOPE_CONFIG: Record<
  string,
  { variant: "primary" | "secondary" | "success" | "info"; label: string }
> = {
  user: { variant: "secondary", label: "User" },
  organization: { variant: "info", label: "Org" },
  workspace: { variant: "primary", label: "Workspace" },
  environment: { variant: "success", label: "Environment" },
};

/**
 * ScopeBadge — displays a secret/token scope type as a colored badge.
 */
export function ScopeBadge({ scopeType, className = "" }: ScopeBadgeProps) {
  const config = SCOPE_CONFIG[scopeType] ?? {
    variant: "primary" as const,
    label: scopeType,
  };

  return (
    <Badge variant={config.variant} size="sm" className={className}>
      {config.label}
    </Badge>
  );
}
