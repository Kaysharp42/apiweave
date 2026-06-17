import { useState, useEffect, useCallback } from 'react';
import { Shield } from 'lucide-react';
import { Panel } from '../components/molecules/Panel';
import { AuditEventTable } from '../components/audit/AuditEventTable';
import { AuditFilters } from '../components/audit/AuditFilters';
import { AuditJsonExportButton } from '../components/audit/AuditJsonExportButton';
import { authenticatedJson } from '../utils/authenticatedApi';
import API_BASE_URL from '../utils/api';
import type { AuditEvent, AuditEventFilter, AuditEventListResponse } from '../types';

function buildListUrl(filters: AuditEventFilter): string {
  const params = new URLSearchParams();
  if (filters.actor) params.set('actor', filters.actor);
  if (filters.action) params.set('action', filters.action);
  if (filters.scope) params.set('scope', filters.scope);
  if (filters.resourceType) params.set('resourceType', filters.resourceType);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  params.set('skip', String(filters.skip ?? 0));
  params.set('limit', String(filters.limit ?? 100));
  const qs = params.toString();
  return `${API_BASE_URL}/api/audit/events${qs ? `?${qs}` : ''}`;
}

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<AuditEventFilter>({ limit: 100 });

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await authenticatedJson<AuditEventListResponse>(buildListUrl(filters));
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

  const handlePageChange = useCallback((direction: 'next' | 'prev') => {
    setFilters((prev) => {
      const currentSkip = prev.skip ?? 0;
      const limit = prev.limit ?? 100;
      const newSkip = direction === 'next' ? currentSkip + limit : Math.max(0, currentSkip - limit);
      return { ...prev, skip: newSkip };
    });
  }, []);

  const currentSkip = filters.skip ?? 0;
  const limit = filters.limit ?? 100;
  const hasPrev = currentSkip > 0;
  const hasNext = currentSkip + limit < total;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-text-primary dark:text-text-primary-dark flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" aria-hidden="true" />
            Audit Log
          </h1>
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark mt-1">
            Read-only audit trail. No secret values are stored or displayed.
          </p>
        </div>
        <AuditJsonExportButton filters={filters} />
      </div>

      <Panel title="Filters" icon={Shield} collapsible defaultExpanded>
        <AuditFilters filters={filters} onChange={handleFilterChange} />
      </Panel>

      <Panel title={`Events (${total})`} icon={Shield}>
        <AuditEventTable events={events} loading={loading} />

        {total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border dark:border-border-dark">
            <span className="text-xs text-text-muted dark:text-text-muted-dark">
              Showing {currentSkip + 1}–{Math.min(currentSkip + limit, total)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={!hasPrev}
                onClick={() => handlePageChange('prev')}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={!hasNext}
                onClick={() => handlePageChange('next')}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
