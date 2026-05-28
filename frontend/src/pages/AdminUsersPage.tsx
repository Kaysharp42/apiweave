import { useState, useEffect, useCallback } from 'react';
import { Button } from '../components/atoms/Button';
import { StatusBadge } from '../components/molecules/StatusBadge';
import { InviteUserModal } from '../components/auth/InviteUserModal';
import { authenticatedJson, authenticatedFetch, copyInviteLink } from '../utils/authenticatedApi';
import API_BASE_URL from '../utils/api';
import type { User, InviteResponse } from '../types';
import { toast } from 'sonner';
import { Loader2, Shield, Trash2 } from 'lucide-react';
import { useAuth } from '../auth/useAuth';

interface DeleteConfirmState {
  type: 'user' | 'invite';
  id: string;
  label: string;
}

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [invites, setInvites] = useState<InviteResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [copyingInviteId, setCopyingInviteId] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const [userData, inviteData] = await Promise.all([
        authenticatedJson<User[]>(`${API_BASE_URL}/api/users`),
        authenticatedJson<InviteResponse[]>(`${API_BASE_URL}/api/auth/invites`),
      ]);
      setUsers(userData);
      const now = new Date();
      setInvites(inviteData.filter(inv => !inv.consumed && new Date(inv.expires_at) > now));
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const handleRoleChange = async (userId: string, newRole: string) => {
    if (userId === currentUser?.userId && newRole !== 'admin') {
      const adminCount = users.filter((u) => u.roles.includes('admin')).length;
      if (adminCount <= 1) {
        toast.error('Cannot demote the last admin user');
        return;
      }
    }

    try {
      const updatedUser = await authenticatedJson<User>(
        `${API_BASE_URL}/api/users/${userId}/roles`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roles: [newRole] }),
        }
      );
      setUsers((prev) => prev.map((u) => (u.userId === userId ? updatedUser : u)));
      toast.success('User role updated');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update role';
      toast.error(msg);
    }
  };

  const handleInviteRoleChange = async (inviteId: string, newRole: string) => {
    try {
      await authenticatedJson(
        `${API_BASE_URL}/api/invites/${inviteId}/role`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role_preset: newRole }),
        }
      );
      setInvites((prev) =>
        prev.map((inv) => (inv.inviteId === inviteId ? { ...inv, role_preset: newRole } : inv))
      );
      toast.success('Invite role updated');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update invite role';
      toast.error(msg);
    }
  };

  const handleCopyInviteLink = async (inviteId: string, inviteUrl: string) => {
    setCopyingInviteId(inviteId);
    const success = await copyInviteLink(inviteUrl);
    if (success) {
      toast.success('Invite link copied');
    } else {
      toast.error('Failed to copy invite link');
    }
    setTimeout(() => setCopyingInviteId(null), 1500);
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      if (deleteConfirm.type === 'user') {
        await authenticatedFetch(`${API_BASE_URL}/api/users/${deleteConfirm.id}`, {
          method: 'DELETE',
        });
        setUsers((prev) => prev.filter((u) => u.userId !== deleteConfirm.id));
        toast.success('User deleted');
      } else {
        await authenticatedFetch(`${API_BASE_URL}/api/invites/${deleteConfirm.id}`, {
          method: 'DELETE',
        });
        setInvites((prev) => prev.filter((inv) => inv.inviteId !== deleteConfirm.id));
        toast.success('Invite deleted');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete';
      toast.error(msg);
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  };

  // Map email (lowercase) → invite for quick lookup on pending user rows
  const inviteByEmail = new Map(invites.map((inv) => [inv.email.toLowerCase(), inv]));

  // Invite-only rows: invites whose email has no matching user yet (case-insensitive)
  const orphanInvites = invites.filter(
    (inv) => !users.some((u) => u.verified_email.toLowerCase() === inv.email.toLowerCase())
  );

  return (
    <>
      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="w-6 h-6 text-primary" />
              User Management
            </h1>
            <Button onClick={() => setInviteModalOpen(true)}>Invite User</Button>
          </div>

          <div className="bg-surface-raised dark:bg-surface-dark-raised border border-border dark:border-border-dark rounded-lg overflow-hidden">
            {loading ? (
              <div className="flex justify-center p-12 text-text-muted">
                <Loader2 className="w-8 h-8 animate-spin" />
              </div>
            ) : (
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-text-secondary dark:text-text-secondary-dark uppercase bg-surface dark:bg-surface-dark border-b border-border dark:border-border-dark">
                  <tr>
                    <th className="px-6 py-4">User</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Roles</th>
                    <th className="px-6 py-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 && orphanInvites.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-text-muted">
                        No users found
                      </td>
                    </tr>
                  ) : (
                    <>
                      {users.map((user) => {
                        const primaryRole = user.roles.includes('admin')
                          ? 'admin'
                          : user.roles.includes('editor')
                          ? 'editor'
                          : 'viewer';

                        // Case-insensitive email match; only show invite link if setup not complete
                        const pendingInvite = !user.is_setup_complete
                          ? inviteByEmail.get(user.verified_email.toLowerCase())
                          : undefined;

                        const isSelf = user.userId === currentUser?.userId;

                        return (
                          <tr
                            key={user.userId}
                            className="border-b border-border dark:border-border-dark last:border-0 hover:bg-surface dark:hover:bg-surface-dark transition-colors"
                          >
                            <td className="px-6 py-4">
                              <div className="font-medium">{user.display_name || 'No Name'}</div>
                              <div className="text-text-secondary dark:text-text-secondary-dark text-xs mt-0.5">
                                {user.verified_email}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              {user.is_setup_complete ? (
                                <StatusBadge status="success" label="Active" />
                              ) : (
                                <StatusBadge status="warning" label="Pending" />
                              )}
                            </td>
                            <td className="px-6 py-4 flex gap-1 flex-wrap">
                              {user.roles.map((r) => (
                                <span
                                  key={r}
                                  className="px-2 py-0.5 bg-primary/10 text-primary dark:text-primary-light rounded-full text-xs font-medium"
                                >
                                  {r}
                                </span>
                              ))}
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <select
                                  className="select select-sm select-bordered bg-surface dark:bg-surface-dark"
                                  value={primaryRole}
                                  onChange={(e) => handleRoleChange(user.userId, e.target.value)}
                                >
                                  <option value="admin">Admin</option>
                                  <option value="editor">Editor</option>
                                  <option value="viewer">Viewer</option>
                                </select>
                                {pendingInvite?.invite_url && (
                                  <Button
                                    size="xs"
                                    variant="secondary"
                                    onClick={() =>
                                      handleCopyInviteLink(
                                        pendingInvite.inviteId,
                                        pendingInvite.invite_url!
                                      )
                                    }
                                  >
                                    {copyingInviteId === pendingInvite.inviteId ? 'Copied!' : 'Copy Link'}
                                  </Button>
                                )}
                                {!isSelf && (
                                  <button
                                    className="p-1 text-text-muted hover:text-error transition-colors rounded"
                                    title="Delete user"
                                    onClick={() =>
                                      setDeleteConfirm({
                                        type: 'user',
                                        id: user.userId,
                                        label: user.display_name || user.verified_email,
                                      })
                                    }
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}

                      {orphanInvites.map((inv) => (
                        <tr
                          key={inv.inviteId}
                          className="border-b border-border dark:border-border-dark last:border-0 hover:bg-surface dark:hover:bg-surface-dark transition-colors"
                        >
                          <td className="px-6 py-4">
                            <div className="font-medium">{inv.email}</div>
                            <div className="text-text-secondary dark:text-text-secondary-dark text-xs mt-0.5">
                              Invite pending
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <StatusBadge status="warning" label="Invited" />
                          </td>
                          <td className="px-6 py-4 flex gap-1 flex-wrap">
                            <span className="px-2 py-0.5 bg-primary/10 text-primary dark:text-primary-light rounded-full text-xs font-medium">
                              {inv.role_preset}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <select
                                className="select select-sm select-bordered bg-surface dark:bg-surface-dark"
                                value={inv.role_preset}
                                onChange={(e) => handleInviteRoleChange(inv.inviteId, e.target.value)}
                              >
                                <option value="admin">Admin</option>
                                <option value="editor">Editor</option>
                                <option value="viewer">Viewer</option>
                              </select>
                              {inv.invite_url && (
                                <Button
                                  size="xs"
                                  variant="secondary"
                                  onClick={() => handleCopyInviteLink(inv.inviteId, inv.invite_url!)}
                                >
                                  {copyingInviteId === inv.inviteId ? 'Copied!' : 'Copy Link'}
                                </Button>
                              )}
                              <button
                                className="p-1 text-text-muted hover:text-error transition-colors rounded"
                                title="Delete invite"
                                onClick={() =>
                                  setDeleteConfirm({
                                    type: 'invite',
                                    id: inv.inviteId,
                                    label: inv.email,
                                  })
                                }
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>

      <InviteUserModal
        isOpen={inviteModalOpen}
        onClose={() => {
          setInviteModalOpen(false);
          void fetchUsers();
        }}
      />

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h2 className="text-lg font-semibold mb-2">Confirm Delete</h2>
            <p className="text-text-secondary dark:text-text-secondary-dark text-sm mb-6">
              Are you sure you want to delete{' '}
              <span className="font-medium text-text dark:text-text-dark">
                {deleteConfirm.label}
              </span>
              ? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                intent="error"
                loading={deleting}
                onClick={() => void handleDeleteConfirmed()}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
