import type { AuditEvent } from '../../types';
import { AuditEventRow } from './AuditEventRow';
import { EmptyState } from '../molecules/EmptyState';
import { Shield } from 'lucide-react';

interface AuditEventTableProps {
  events: AuditEvent[];
  loading: boolean;
}

export function AuditEventTable({ events, loading }: AuditEventTableProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <EmptyState
        icon={<Shield className="w-12 h-12 text-text-muted dark:text-text-muted-dark" strokeWidth={1.5} />}
        title="No audit events"
        description="No events match the current filters. Try adjusting your filter criteria."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded border border-border dark:border-border-dark">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay">
            <th className="px-3 py-2 text-xs font-semibold text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider">
              Time
            </th>
            <th className="px-3 py-2 text-xs font-semibold text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider">
              Actor
            </th>
            <th className="px-3 py-2 text-xs font-semibold text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider">
              Action
            </th>
            <th className="px-3 py-2 text-xs font-semibold text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider">
              Scope
            </th>
            <th className="px-3 py-2 text-xs font-semibold text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider">
              Resource Type
            </th>
            <th className="px-3 py-2 text-xs font-semibold text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider">
              Resource ID
            </th>
          </tr>
        </thead>
        <tbody className="bg-surface-raised dark:bg-surface-dark-raised">
          {events.map((event) => (
            <AuditEventRow key={event.eventId} event={event} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
