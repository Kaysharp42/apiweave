import type { AuditEvent } from '../../types';

interface AuditEventRowProps {
  event: AuditEvent;
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function AuditEventRow({ event }: AuditEventRowProps) {
  return (
    <tr className="border-b border-border dark:border-border-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors">
      <td className="px-3 py-2 text-xs font-mono text-text-muted dark:text-text-muted-dark">
        {formatTimestamp(event.createdAt)}
      </td>
      <td className="px-3 py-2">
        <span className="badge badge-sm badge-ghost font-medium">
          {event.actor}
        </span>
      </td>
      <td className="px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark">
        {event.action}
      </td>
      <td className="px-3 py-2">
        <span className="badge badge-sm badge-outline">
          {event.scope}
        </span>
      </td>
      <td className="px-3 py-2 text-sm text-text-secondary dark:text-text-secondary-dark">
        {event.resourceType}
      </td>
      <td className="px-3 py-2 text-xs font-mono text-text-muted dark:text-text-muted-dark truncate max-w-[12rem]">
        {event.resourceId}
      </td>
    </tr>
  );
}
