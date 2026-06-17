import { Shield, ShieldCheck, Users, CheckCircle2, XCircle, Key } from 'lucide-react';
import { Badge } from '../atoms/Badge';
import { Button } from '../atoms/Button';
import type { ProtectionSummaryProps } from '../../types';

export function ProtectionSummary({
  protection,
  onEdit,
  className = '',
}: ProtectionSummaryProps) {
  if (!protection) {
    return (
      <div
        className={`flex items-center gap-3 p-3 rounded-lg border border-border/60 dark:border-border-dark/60 bg-surface-overlay dark:bg-surface-dark-overlay ${className}`}
      >
        <Shield className="w-5 h-5 text-text-muted dark:text-text-muted-dark flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">
            Unprotected
          </p>
          <p className="text-xs text-text-muted dark:text-text-muted-dark">
            No approval required — runs execute immediately
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onEdit}>
          Configure
        </Button>
      </div>
    );
  }

  const reviewerCount = protection.requiredReviewers.length;
  const bypassEnabled = protection.bypassPolicy === 'trusted_token_only';
  const allowlistCount = protection.bypassAllowlist.length;

  return (
    <div
      className={`p-3 rounded-lg border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised space-y-3 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-status-success flex-shrink-0" />
          <span className="text-sm font-semibold text-text-primary dark:text-text-primary-dark">
            Protected
          </span>
        </div>
        <Button variant="ghost" size="xs" onClick={onEdit}>
          Edit
        </Button>
      </div>

      {/* Details */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {/* Reviewers */}
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-surface-overlay dark:bg-surface-dark-overlay">
          <Users className="w-3.5 h-3.5 text-text-secondary dark:text-text-secondary-dark flex-shrink-0" />
          <span className="text-xs text-text-secondary dark:text-text-secondary-dark">
            {reviewerCount} reviewer{reviewerCount !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Self-Approval */}
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-surface-overlay dark:bg-surface-dark-overlay">
          {protection.allowSelfApproval ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-status-success flex-shrink-0" />
              <span className="text-xs text-text-secondary dark:text-text-secondary-dark">
                Self-approval allowed
              </span>
            </>
          ) : (
            <>
              <XCircle className="w-3.5 h-3.5 text-status-error flex-shrink-0" />
              <span className="text-xs text-text-secondary dark:text-text-secondary-dark">
                Self-approval denied
              </span>
            </>
          )}
        </div>

        {/* Bypass */}
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-surface-overlay dark:bg-surface-dark-overlay">
          <Key className="w-3.5 h-3.5 text-text-secondary dark:text-text-secondary-dark flex-shrink-0" />
          {bypassEnabled ? (
            <Badge variant="warning" size="xs">
              {allowlistCount} token{allowlistCount !== 1 ? 's' : ''}
            </Badge>
          ) : (
            <span className="text-xs text-text-muted dark:text-text-muted-dark">
              No bypass
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
