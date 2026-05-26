import type { User } from '../../types';

export function getAccountDisplayName(user: User): string {
  const trimmedDisplayName = user.display_name?.trim();
  if (trimmedDisplayName) return trimmedDisplayName;

  const emailPrefix = user.verified_email.split('@')[0]?.trim();
  if (emailPrefix) return emailPrefix;

  return user.userId;
}

export function getAccountInitials(user: User, displayName: string): string {
  const source = displayName || user.verified_email;
  if (!source) {
    return (user.userId[0] ?? 'U').toUpperCase();
  }

  const initials = source
    .split(/[\s@._-]+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return initials || 'U';
}

export function getRoleSummary(user: User): string {
  if (user.roles.includes('admin')) return 'Admin · full access';
  if (user.roles.includes('editor')) return 'Editor · workflow author';
  if (user.roles.includes('viewer')) return 'Viewer · read only';

  if (user.roles.length === 0) return 'No role assigned';

  return user.roles.map((role) => role.charAt(0).toUpperCase() + role.slice(1)).join(' · ');
}
