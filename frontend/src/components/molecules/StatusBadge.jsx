import React from 'react';
import { Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';

/**
 * StatusBadge — Execution status indicator (running / success / fail / pending).
 *
 * @param {'pending'|'running'|'success'|'error'|'skipped'} status
 * @param {string} label — optional override for the display text
 * @param {'sm'|'md'} size
 */
export default function StatusBadge({
  status = 'pending',
  label,
  size = 'sm',
  className = '',
}) {
  const config = {
    pending: {
      icon: Clock,
      text: 'Pending',
      badgeClass: 'badge-ghost',
      iconClass: 'text-text-muted',
    },
    running: {
      icon: Loader2,
      text: 'Running',
      badgeClass: 'badge-warning',
      iconClass: 'text-warning animate-spin',
    },
    success: {
      icon: CheckCircle2,
      text: 'Success',
      badgeClass: 'badge-success',
      iconClass: 'text-success',
    },
    error: {
      icon: XCircle,
      text: 'Failed',
      badgeClass: 'badge-error',
      iconClass: 'text-error',
    },
    skipped: {
      icon: Clock,
      text: 'Skipped',
      badgeClass: 'badge-ghost',
      iconClass: 'text-text-muted',
    },
  };

  const { icon: Icon, text, badgeClass, iconClass } = config[status] ?? config.pending;

  const sizeClass = size === 'sm' ? 'badge-sm' : '';
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';

  return (
    <span
      className={['badge gap-1', badgeClass, sizeClass, className].filter(Boolean).join(' ')}
    >
      <Icon className={`${iconSize} ${iconClass}`} />
      {label ?? text}
    </span>
  );
}
