import type { AuditEventFilter } from "../../types";
import { Input } from "../atoms/Input";

interface AuditFiltersProps {
  filters: AuditEventFilter;
  onChange: (filters: AuditEventFilter) => void;
}

const ACTOR_OPTIONS = [
  "",
  "user",
  "org_app",
  "service_token",
  "mcp_client",
  "webhook_token",
  "system_migration",
] as const;
const SCOPE_OPTIONS = ["", "org", "workspace", "environment"] as const;

function withField<K extends keyof AuditEventFilter>(
  base: AuditEventFilter,
  key: K,
  value: string,
): AuditEventFilter {
  const next = { ...base };
  if (value) {
    (next as Record<K, AuditEventFilter[K]>)[key] =
      value as AuditEventFilter[K];
  } else {
    delete next[key];
  }
  return next;
}

export function AuditFilters({ filters, onChange }: AuditFiltersProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 p-4 bg-surface-raised dark:bg-surface-dark-raised">
      <div>
        <label className="label py-1 px-0">
          <span className="label-text text-xs font-medium text-text-primary dark:text-text-primary-dark">
            Actor
          </span>
        </label>
        <select
          className="select select-bordered select-sm w-full rounded bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border-border dark:border-border-dark focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
          value={filters.actor ?? ""}
          onChange={(e) =>
            onChange(withField(filters, "actor", e.target.value))
          }
        >
          {ACTOR_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt || "All actors"}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Input
          label="Action"
          size="sm"
          placeholder="e.g. secret_resolved"
          value={filters.action ?? ""}
          onChange={(e) =>
            onChange(
              withField(
                filters,
                "action",
                (e.target as HTMLInputElement).value,
              ),
            )
          }
        />
      </div>

      <div>
        <label className="label py-1 px-0">
          <span className="label-text text-xs font-medium text-text-primary dark:text-text-primary-dark">
            Scope
          </span>
        </label>
        <select
          className="select select-bordered select-sm w-full rounded bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border-border dark:border-border-dark focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
          value={filters.scope ?? ""}
          onChange={(e) =>
            onChange(withField(filters, "scope", e.target.value))
          }
        >
          {SCOPE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt || "All scopes"}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Input
          label="Resource Type"
          size="sm"
          placeholder="e.g. secret"
          value={filters.resourceType ?? ""}
          onChange={(e) =>
            onChange(
              withField(
                filters,
                "resourceType",
                (e.target as HTMLInputElement).value,
              ),
            )
          }
        />
      </div>

      <div>
        <Input
          label="From"
          size="sm"
          type="date"
          value={filters.from ?? ""}
          onChange={(e) =>
            onChange(
              withField(filters, "from", (e.target as HTMLInputElement).value),
            )
          }
        />
      </div>

      <div>
        <Input
          label="To"
          size="sm"
          type="date"
          value={filters.to ?? ""}
          onChange={(e) =>
            onChange(
              withField(filters, "to", (e.target as HTMLInputElement).value),
            )
          }
        />
      </div>
    </div>
  );
}
