import { Loader2, CheckCircle2, XCircle, Clock, AlertTriangle, Info, type LucideIcon } from 'lucide-react';
import type { StatusBadgeProps } from '../../types';

export function StatusBadge({
  status = 'idle',
  label,
  size = 'sm',
  className = '',
}: StatusBadgeProps) {
  const statusMap: Record<string, { icon: LucideIcon; text: string; badgeClass: string; iconClass: string }> = {
    idle: {
      icon: Clock,
      text: 'Idle',
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
    warning: {
      icon: AlertTriangle,
      text: 'Warning',
      badgeClass: 'badge-warning',
      iconClass: 'text-warning',
    },
    info: {
      icon: Info,
      text: 'Info',
      badgeClass: 'badge-info',
      iconClass: 'text-info',
    },
  };

  const config = statusMap[status] ?? statusMap.idle;
  const Icon = config!.icon;
  const text = config!.text;
  const badgeClass = config!.badgeClass;
  const iconClass = config!.iconClass;

  const sizeClass = size === 'sm' ? 'badge-sm' : size === 'xs' ? 'badge-xs' : '';
  const iconSize = size === 'xs' ? 'w-3 h-3' : size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  const displayText = label ?? text;

  return (
    <span
      className={['badge gap-1', badgeClass, sizeClass, className].filter(Boolean).join(' ')}
      aria-label={displayText}
      role="status"
    >
      <Icon className={`${iconSize} ${iconClass}`} aria-hidden="true" />
      <span className="truncate">{displayText}</span>
    </span>
  );
}
