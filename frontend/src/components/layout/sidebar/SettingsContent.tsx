import { Shield, Settings as SettingsIcon } from 'lucide-react';
import type { SettingsContentProps } from '../../../types';

/**
 * Renders the settings section of the sidebar.
 * Shows admin-only settings (User Management, Domain & SSO) or
 * a message for non-admin users.
 */
export function SettingsContent({
  hasPermission,
  onNavigate,
}: SettingsContentProps) {
  if (!hasPermission('users:invite')) {
    return (
      <div className="p-4 text-sm text-text-secondary dark:text-text-secondary-dark">
        Settings are available for administrators only.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <ul className="w-full p-2 space-y-1">
        <li>
          <button
            type="button"
            className={[
              'flex items-center gap-3 w-full rounded-lg px-3 py-2 text-left',
              'hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay',
              'focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]',
              'cursor-pointer transition-colors',
            ].join(' ')}
            onClick={() => onNavigate('/settings/users')}
          >
            <Shield className="w-4 h-4 text-text-muted dark:text-text-muted-dark flex-shrink-0" />
            <div className="min-w-0 text-left">
              <div className="font-medium text-text-primary dark:text-text-primary-dark text-sm">User Management</div>
              <div className="text-xs text-text-secondary dark:text-text-secondary-dark">Manage users and invitations</div>
            </div>
          </button>
        </li>
        <li>
          <button
            type="button"
            className={[
              'flex items-center gap-3 w-full rounded-lg px-3 py-2 text-left',
              'hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay',
              'focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]',
              'cursor-pointer transition-colors',
            ].join(' ')}
            onClick={() => onNavigate('/settings/domains')}
          >
            <SettingsIcon className="w-4 h-4 text-text-muted dark:text-text-muted-dark flex-shrink-0" />
            <div className="min-w-0 text-left">
              <div className="font-medium text-text-primary dark:text-text-primary-dark text-sm">Domain &amp; SSO Settings</div>
              <div className="text-xs text-text-secondary dark:text-text-secondary-dark">Configure domain and SSO</div>
            </div>
          </button>
        </li>
      </ul>
    </div>
  );
}