import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Shield } from "lucide-react";
import { Button } from "../components/atoms/Button";
import { Panel } from "../components/molecules/Panel";
import { AuditEventTable } from "../components/audit/AuditEventTable";
import { AuditFilters } from "../components/audit/AuditFilters";
import { AuditJsonExportButton } from "../components/audit/AuditJsonExportButton";
import { authenticatedJson } from "../utils/authenticatedApi";
import API_BASE_URL from "../utils/api";
import type {
  AuditEvent,
  AuditEventFilter,
  AuditEventListResponse,
} from "../types";

function buildListUrl(filters: AuditEventFilter): string {
  const params = new URLSearchParams();
  if (filters.actor) params.set("actor", filters.actor);
  if (filters.action) params.set("action", filters.action);
  if (filters.scope) params.set("scope", filters.scope);
  if (filters.resourceType) params.set("resourceType", filters.resourceType);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  params.set("skip", String(filters.skip ?? 0));
  params.set("limit", String(filters.limit ?? 100));
  const qs = params.toString();
  return `${API_BASE_URL}/api/audit/events${qs ? `?${qs}` : ""}`;
}

export default function AuditPage() {
  const { orgSlug, workspaceSlug } = useParams<{
    orgSlug: string;
    workspaceSlug: string;
  }>();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<AuditEventFilter>({ limit: 100 });

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await authenticatedJson<AuditEventListResponse>(
        buildListUrl(filters),
      );
      setEvents(data.events);
      setTotal(data.total);
    } catch {
      setEvents([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleFilterChange = useCallback((newFilters: AuditEventFilter) => {
    setFilters({ ...newFilters, skip: 0 });
  }, []);

  const handlePageChange = useCallback((direction: "next" | "prev") => {
    setFilters((prev) => {
      const currentSkip = prev.skip ?? 0;
      const limit = prev.limit ?? 100;
      const newSkip =
        direction === "next"
          ? currentSkip + limit
          : Math.max(0, currentSkip - limit);
      return { ...prev, skip: newSkip };
    });
  }, []);

  const currentSkip = filters.skip ?? 0;
  const limit = filters.limit ?? 100;
  const hasPrev = currentSkip > 0;
  const hasNext = currentSkip + limit < total;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-6 border-b border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
        <Shield
          className="w-5 h-5 text-text-secondary dark:text-text-secondary-dark"
          aria-hidden="true"
        />
        <div>
          <h1 className="text-3xl font-bold font-display tracking-tight text-text-primary dark:text-text-primary-dark">
            Audit Log
          </h1>
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
            {orgSlug && workspaceSlug
              ? `${orgSlug} / ${workspaceSlug}`
              : "Read-only audit trail. No secret values are stored or displayed."}
          </p>
        </div>
        <div className="ml-auto">
          <AuditJsonExportButton filters={filters} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
          <Panel title="Filters" icon={Shield} collapsible defaultExpanded>
            <AuditFilters filters={filters} onChange={handleFilterChange} />
          </Panel>

          <Panel title={`Events (${total})`} icon={Shield}>
            <AuditEventTable events={events} loading={loading} />

            {total > 0 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border dark:border-border-dark">
                <span className="text-xs text-text-muted dark:text-text-muted-dark">
                  Showing {currentSkip + 1}–
                  {Math.min(currentSkip + limit, total)} of {total}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!hasPrev}
                    onClick={() => handlePageChange("prev")}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!hasNext}
                    onClick={() => handlePageChange("next")}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
