import { useReducer, useEffect, useCallback } from 'react';
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
  type AdminUsersState = {
    users: User[];
    invites: InviteResponse[];
    loading: boolean;
    inviteModalOpen: boolean;
    deleteConfirm: DeleteConfirmState | null;
    deleting: boolean;
    copyingInviteId: string | null;
  };

  type AdminUsersAction =
    | { type: 'set-users'; value: User[] }
    | { type: 'set-invites'; value: InviteResponse[] }
    | { type: 'set-loading'; value: boolean }
    | { type: 'set-invite-modal-open'; value: boolean }
    | { type: 'set-delete-confirm'; value: DeleteConfirmState | null }
    | { type: 'set-deleting'; value: boolean }
    | { type: 'set-copying-invite-id'; value: string | null };

  const [state, dispatch] = useReducer((current: AdminUsersState, action: AdminUsersAction): AdminUsersState => {
    switch (action.type) {
      case 'set-users':
        return { ...current, users: action.value };
      case 'set-invites':
        return { ...current, invites: action.value };
      case 'set-loading':
        return { ...current, loading: action.value };
      case 'set-invite-modal-open':
        return { ...current, inviteModalOpen: action.value };
      case 'set-delete-confirm':
        return { ...current, deleteConfirm: action.value };
      case 'set-deleting':
        return { ...current, deleting: action.value };
      case 'set-copying-invite-id':
        return { ...current, copyingInviteId: action.value };
      default:
        return current;
    }
  }, {
    users: [],
    invites: [],
    loading: true,
    inviteModalOpen: false,
    deleteConfirm: null,
    deleting: false,
    copyingInviteId: null,
  });

  const fetchUsers = useCallback(async () => {
    try {
      dispatch({ type: 'set-loading', value: true });
      const [userData, inviteData] = await Promise.all([
        authenticatedJson<User[]>(`${API_BASE_URL}/api/users`),
        authenticatedJson<InviteResponse[]>(`${API_BASE_URL}/api/auth/invites`),
      ]);
      dispatch({ type: 'set-users', value: userData });
      const now = new Date();
      dispatch({ type: 'set-invites', value: inviteData.filter(inv => !inv.consumed && new Date(inv.expires_at) > now) });
    } catch {
      toast.error('Failed to load users');
    } finally {
      dispatch({ type: 'set-loading', value: false });
    }
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const handleRoleChange = async (userId: string, newRole: string) => {
    if (userId === currentUser?.userId && newRole !== 'admin') {
      const adminCount = state.users.filter((u) => u.roles.includes('admin')).length;
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
      dispatch({ type: 'set-users', value: state.users.map((u) => (u.userId === userId ? updatedUser : u)) });
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
      dispatch({ type: 'set-invites', value: state.invites.map((inv) => (inv.inviteId === inviteId ? { ...inv, role_preset: newRole } : inv)) });
      toast.success('Invite role updated');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update invite role';
      toast.error(msg);
    }
  };

  const handleCopyInviteLink = async (inviteId: string, inviteUrl: string) => {
    dispatch({ type: 'set-copying-invite-id', value: inviteId });
    const success = await copyInviteLink(inviteUrl);
    if (success) {
      toast.success('Invite link copied');
    } else {
      toast.error('Failed to copy invite link');
    }
    setTimeout(() => dispatch({ type: 'set-copying-invite-id', value: null }), 1500);
  };

  const handleDeleteConfirmed = async () => {
    if (!state.deleteConfirm) return;
    dispatch({ type: 'set-deleting', value: true });
    try {
      if (state.deleteConfirm.type === 'user') {
        await authenticatedFetch(`${API_BASE_URL}/api/users/${state.deleteConfirm.id}`, {
          method: 'DELETE',
        });
        dispatch({ type: 'set-users', value: state.users.filter((u) => u.userId !== state.deleteConfirm?.id) });
        toast.success('User deleted');
      } else {
        await authenticatedFetch(`${API_BASE_URL}/api/invites/${state.deleteConfirm.id}`, {
          method: 'DELETE',
        });
        dispatch({ type: 'set-invites', value: state.invites.filter((inv) => inv.inviteId !== state.deleteConfirm?.id) });
        toast.success('Invite deleted');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete';
      toast.error(msg);
    } finally {
      dispatch({ type: 'set-deleting', value: false });
      dispatch({ type: 'set-delete-confirm', value: null });
    }
  };

  // Map email (lowercase) → invite for quick lookup on pending user rows
  const inviteByEmail = new Map(state.invites.map((inv) => [inv.email.toLowerCase(), inv]));

  // Invite-only rows: invites whose email has no matching user yet (case-insensitive)
  const orphanInvites = state.invites.filter(
    (inv) => !state.users.some((u) => u.verified_email.toLowerCase() === inv.email.toLowerCase())
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
            <Button onClick={() => dispatch({ type: 'set-invite-modal-open', value: true })}>Invite User</Button>
          </div>

          <div className="bg-surface-raised dark:bg-surface-dark-raised border border-border dark:border-border-dark rounded-lg overflow-hidden">
            {state.loading ? (
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
                  {state.users.length === 0 && orphanInvites.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-text-muted">
                        No users found
                      </td>
                    </tr>
                  ) : (
                    <>
                      {state.users.map((user) => {
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
                                      {state.copyingInviteId === pendingInvite.inviteId ? 'Copied!' : 'Copy Link'}
                                  </Button>
                                )}
                                {!isSelf && (
                                  <button
                                    type="button"
                                    className="p-1 text-text-muted hover:text-error transition-colors rounded"
                                    title="Delete user"
                                    onClick={() =>
                                      dispatch({
                                        type: 'set-delete-confirm',
                                        value: {
                                        type: 'user',
                                        id: user.userId,
                                        label: user.display_name || user.verified_email,
                                        },
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
                                {state.copyingInviteId === inv.inviteId ? 'Copied!' : 'Copy Link'}
                                </Button>
                              )}
                              <button
                                type="button"
                                className="p-1 text-text-muted hover:text-error transition-colors rounded"
                                title="Delete invite"
                                onClick={() =>
                                  dispatch({
                                    type: 'set-delete-confirm',
                                    value: {
                                    type: 'invite',
                                    id: inv.inviteId,
                                    label: inv.email,
                                    },
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
        isOpen={state.inviteModalOpen}
        onClose={() => {
          dispatch({ type: 'set-invite-modal-open', value: false });
          void fetchUsers();
        }}
      />

      {state.deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50">
          <div className="bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h2 className="text-lg font-semibold mb-2">Confirm Delete</h2>
            <p className="text-text-secondary dark:text-text-secondary-dark text-sm mb-6">
              Are you sure you want to delete{' '}
              <span className="font-medium text-text dark:text-text-dark">
                {state.deleteConfirm.label}
              </span>
              ? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => dispatch({ type: 'set-delete-confirm', value: null })}
                disabled={state.deleting}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                intent="error"
                loading={state.deleting}
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
