import { Lock, Check, X } from "lucide-react";
import { Badge } from "../atoms/Badge";
import type { SecretResolutionIndicatorProps } from "../../types";

export function SecretResolutionIndicator({
  secretRefs,
  resolvedSecrets,
}: SecretResolutionIndicatorProps) {
  if (secretRefs.length === 0) return null;
  const byName = new Map((resolvedSecrets ?? []).map((s) => [s.name, s]));

  return (
    <div className="flex flex-wrap gap-1.5">
      {secretRefs.map((name) => {
        const info = byName.get(name);
        const resolved = info?.resolved === true;
        return (
          <Badge
            key={name}
            variant={resolved ? "success" : "error"}
            size="sm"
            title={
              resolved
                ? `Resolved from ${info?.scopeType ?? "unknown"} scope — value masked`
                : "Not found in any scope — value masked"
            }
          >
            <Lock className="w-3 h-3" aria-hidden="true" />
            <span className="font-mono">{name}</span>
            {resolved ? (
              <span className="inline-flex items-center gap-0.5 opacity-80">
                <Check className="w-3 h-3" />
                <span className="lowercase">{info?.scopeType ?? "resolved"}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 opacity-80">
                <X className="w-3 h-3" />
                <span className="lowercase">missing</span>
              </span>
            )}
          </Badge>
        );
      })}
    </div>
  );
}