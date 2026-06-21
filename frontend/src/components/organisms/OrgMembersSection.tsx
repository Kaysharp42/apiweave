import { useState, useEffect, useCallback } from 'react';
import { UserPlus, Trash2, ShieldAlert } from 'lucide-react';
import { IconButton } from '../atoms/IconButton';
import { Spinner } from '../atoms/Spinner';
import { RoleBadge } from '../atoms/RoleBadge';
import { EmptyState } from '../molecules/EmptyState';
import { Panel } from '../molecules/Panel';
import { ConfirmDialog } from '../molecules/ConfirmDialog';
import { authenticatedJson, authenticatedFetch } from '../../utils/authenticatedApi';
import API_BASE_URL from '../../utils/api';
import type { OrgMember, OrgRole } from '../../types';
import { toast } from 'sonner';

export interface OrgMembersSectionProps {
  orgSlug: string;
  orgId: string;
  currentUserId: string;
}

const ORG_ROLES: OrgRole[] = ['owner', 'member', 'billing', 'security'];

export function OrgMembersSection({ orgSlug, currentUserId }: OrgMembersSectionProps) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [removeConfirm, setRemoveConfirm] = useState<OrgMember | null>(null);
  const [removing, setRemoving] = useState(false);

  const fetchMembers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await authenticatedJson<OrgMember[]>(
        `${API_BASE_URL}/api/orgs/${orgSlug}/members`,
      );
      setMembers(data);
    } catch {
      toast.error('Failed to load members');
    } finally {
      setLoading(false);
    }
  }, [orgSlug]);

  useEffect(() => {
    void fetchMembers();
  }, [fetchMembers]);

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      const updated = await authenticatedJson<OrgMember>(
        `${API_BASE_URL}/api/orgs/${orgSlug}/members/${userId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: newRole }),
        },
      );
      setMembers((prev) =>
        prev.map((m) => (m.userId === userId ? updated : m)),
      );
      toast.success('Role updated');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update role';
      if (message.includes('last_owner') || message.includes('409')) {
        toast.error('Cannot demote or remove the last owner of the organization');
      } else {
        toast.error(message);
      }
    }
  };

  const handleRemoveConfirmed = async () => {
    if (!removeConfirm) return;
    setRemoving(true);
    try {
      await authenticatedFetch(
        `${API_BASE_URL}/api/orgs/${orgSlug}/members/${removeConfirm.userId}`,
        { method: 'DELETE' },
      );
      setMembers((prev) => prev.filter((m) => m.userId !== removeConfirm.userId));
      toast.success('Member removed');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove member';
      if (message.includes('last_owner') || message.includes('409')) {
        toast.error('Cannot remove the last owner of the organization');
      } else {
        toast.error(message);
      }
    } finally {
      setRemoving(false);
      setRemoveConfirm(null);
    }
  };

  const ownerCount = members.filter((m) => m.role === 'owner').length;

  return (
    <>
      <Panel
        title="Members"
        icon={UserPlus}
        headerActions={
          <span className="text-xs text-text-muted dark:text-text-muted-dark">
            {members.length} member{members.length !== 1 ? 's' : ''}
          </span>
        }
      >
        {loading ? (
          <div className="flex justify-center p-12">
            <Spinner size="lg" className="text-primary dark:text-primary-light" />
          </div>
        ) : members.length === 0 ? (
          <EmptyState
            title="No members"
            description="This organization has no members yet."
          />
        ) : (
          <div className="overflow-hidden">
            <table className="w-full text-sm text-left border-collapse">
              <thead className="text-xs text-text-secondary dark:text-text-secondary-dark uppercase bg-surface-overlay dark:bg-surface-dark-overlay border-b border-border dark:border-border-dark">
                <tr>
                  <th className="px-6 py-3">User</th>
                  <th className="px-6 py-3">Role</th>
                  <th className="px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const isSelf = member.userId === currentUserId;
                  const isLastOwner =
                    member.role === 'owner' && ownerCount <= 1;

                  return (
                    <tr
                      key={member.memberId}
                      className="border-b border-border dark:border-border-dark last:border-0 hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors duration-200 motion-reduce:transition-none"
                    >
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-text-primary dark:text-text-primary-dark">
                            {member.userId.slice(0, 8)}…
                          </span>
                          {isSelf && (
                            <span className="text-xs text-text-muted dark:text-text-muted-dark">
                              (you)
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <select
                            className="select select-sm select-bordered rounded bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border-border dark:border-border-dark text-xs focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                            value={member.role}
                            onChange={(e) =>
                              handleRoleChange(member.userId, e.target.value)
                            }
                            disabled={isLastOwner}
                          >
                            {ORG_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                          <RoleBadge role={member.role} />
                        </div>
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          {isLastOwner && (
                            <span className="flex items-center gap-1 text-xs text-status-warning">
                              <ShieldAlert className="w-3.5 h-3.5" />
                              Last owner
                            </span>
                          )}
                          {!isLastOwner && (
                            <IconButton
                              tooltip="Remove member"
                              variant="error"
                              onClick={() => setRemoveConfirm(member)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </IconButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <ConfirmDialog
        open={!!removeConfirm}
        onClose={() => setRemoveConfirm(null)}
        onConfirm={handleRemoveConfirmed}
        title="Remove Member"
        message={
          <>
            Are you sure you want to remove this member from the organization?
            {removing && <Spinner size="sm" className="ml-2" />}
          </>
        }
        confirmLabel="Remove"
        cancelLabel="Cancel"
        intent="error"
      />
    </>
  );
}
