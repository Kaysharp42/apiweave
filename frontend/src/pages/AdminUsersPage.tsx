import { useReducer, useEffect, useCallback, useState } from 'react';
import { Plus, Shield, Trash2 } from 'lucide-react';
import { Button } from '../components/atoms/Button';
import { IconButton } from '../components/atoms/IconButton';
import { Spinner } from '../components/atoms/Spinner';
import { StatusBadge } from '../components/molecules/StatusBadge';
import { EmptyState } from '../components/molecules/EmptyState';
import { Panel } from '../components/molecules/Panel';
import { Card } from '../components/molecules/Card';
import { ConfirmDialog } from '../components/molecules/ConfirmDialog';
import { InviteUserModal } from '../components/auth/InviteUserModal';
import { authenticatedJson, authenticatedFetch, copyInviteLink } from '../utils/authenticatedApi';
import API_BASE_URL from '../utils/api';
import type { User, InviteResponse } from '../types';
import { toast } from 'sonner';
import { useAuth } from '../auth/useAuth';

interface DeleteConfirmState {
  type: 'user' | 'invite';
  id: string;
  label: string;
}

type SelectedUser =
  | { type: 'user'; user: User; pendingInvite?: InviteResponse }
  | { type: 'invite'; invite: InviteResponse };

const formatDate = (value: string): string => {
  const date = new Date(value);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const [selectedUser, setSelectedUser] = useState<SelectedUser | null>(null);
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
      setSelectedUser((current) => (current?.type === 'user' && current.user.userId === userId
        ? { ...current, user: updatedUser }
        : current));
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
      const updatedInvites = state.invites.map((inv) => (inv.inviteId === inviteId ? { ...inv, role_preset: newRole } : inv));
      dispatch({ type: 'set-invites', value: updatedInvites });
      setSelectedUser((current) => {
        if (current?.type === 'invite' && current.invite.inviteId === inviteId) {
          return { type: 'invite', invite: { ...current.invite, role_preset: newRole } };
        }
        if (current?.type === 'user' && current.pendingInvite?.inviteId === inviteId) {
          return { ...current, pendingInvite: { ...current.pendingInvite, role_preset: newRole } };
        }
        return current;
      });
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
        setSelectedUser((current) => (current?.type === 'user' && current.user.userId === state.deleteConfirm?.id ? null : current));
        toast.success('User deleted');
      } else {
        await authenticatedFetch(`${API_BASE_URL}/api/invites/${state.deleteConfirm.id}`, {
          method: 'DELETE',
        });
        dispatch({ type: 'set-invites', value: state.invites.filter((inv) => inv.inviteId !== state.deleteConfirm?.id) });
        setSelectedUser((current) => {
          if (current?.type === 'invite' && current.invite.inviteId === state.deleteConfirm?.id) return null;
          if (current?.type === 'user' && current.pendingInvite?.inviteId === state.deleteConfirm?.id) {
            return { type: 'user', user: current.user };
          }
          return current;
        });
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

  const selectedTitle = selectedUser?.type === 'user'
    ? selectedUser.user.display_name || selectedUser.user.verified_email
    : selectedUser?.invite.email;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-6 border-b border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
        <Shield className="w-5 h-5 text-text-secondary dark:text-text-secondary-dark" />
        <div>
          <h1 className="text-3xl font-bold font-display tracking-tight text-text-primary dark:text-text-primary-dark">
              User Management
          </h1>
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
            Manage users, pending setup, and role access.
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="flex justify-end">
              <Button
                variant="primary"
                intent="success"
                size="sm"
                icon={<Plus className="w-4 h-4" />}
                onClick={() => dispatch({ type: 'set-invite-modal-open', value: true })}
              >
                Invite User
              </Button>
            </div>

            <Panel title="Users">
            {state.loading ? (
              <div className="flex justify-center p-12 text-text-muted">
                <Spinner size="lg" className="text-primary dark:text-primary-light" />
              </div>
            ) : (
              <div className="overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-text-secondary dark:text-text-secondary-dark uppercase bg-surface-overlay dark:bg-surface-dark-overlay border-b border-border dark:border-border-dark">
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
                        <td colSpan={4}>
                          <EmptyState
                            title="No users found"
                            description="Invite users to get started with your workspace."
                          />
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
                          const isSelected = selectedUser?.type === 'user' && selectedUser.user.userId === user.userId;

                          return (
                            <tr
                              key={user.userId}
                              className={`border-b border-border dark:border-border-dark last:border-0 hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors focus-within:outline-2 focus-within:outline-[var(--aw-primary)] focus-within:outline-offset-[-2px] cursor-pointer ${isSelected ? 'bg-primary/5 dark:bg-primary-light/10' : ''}`}
                              tabIndex={0}
                              onClick={() => setSelectedUser({ type: 'user', user, ...(pendingInvite ? { pendingInvite } : {}) })}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  setSelectedUser({ type: 'user', user, ...(pendingInvite ? { pendingInvite } : {}) });
                                }
                              }}
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
                              <td className="px-6 py-4">
                                <div className="flex gap-1 flex-wrap">
                                  {user.roles.map((r) => (
                                    <span
                                      key={r}
                                      className="px-2 py-0.5 bg-primary/10 text-primary dark:text-primary-light rounded-full text-xs font-medium"
                                    >
                                      {r}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                  <select
                                    className="select select-sm select-bordered bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border-border dark:border-border-dark focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] transition-[border-color,box-shadow,outline] duration-[var(--aw-transition-fast)] ease-in-out cursor-pointer"
                                    value={primaryRole}
                                    onClick={(event) => event.stopPropagation()}
                                    onChange={(e) => handleRoleChange(user.userId, e.target.value)}
                                  >
                                    <option value="admin">Admin</option>
                                    <option value="editor">Editor</option>
                                    <option value="viewer">Viewer</option>
                                  </select>
                                  {pendingInvite?.invite_url && (
                                    <Button
                                      size="xs"
                                      variant="outline"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleCopyInviteLink(
                                          pendingInvite.inviteId,
                                          pendingInvite.invite_url!
                                        );
                                      }}
                                    >
                                      {state.copyingInviteId === pendingInvite.inviteId ? 'Copied!' : 'Copy Link'}
                                    </Button>
                                  )}
                                  {!isSelf && (
                                    <IconButton
                                      tooltip="Delete user"
                                      variant="error"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        dispatch({
                                          type: 'set-delete-confirm',
                                          value: {
                                            type: 'user',
                                            id: user.userId,
                                            label: user.display_name || user.verified_email,
                                          },
                                        });
                                      }}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </IconButton>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}

                        {orphanInvites.map((inv) => {
                            const isSelected = selectedUser?.type === 'invite' && selectedUser.invite.inviteId === inv.inviteId;
                            return (
                              <tr
                                key={inv.inviteId}
                                className={`border-b border-border dark:border-border-dark last:border-0 hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors focus-within:outline-2 focus-within:outline-[var(--aw-primary)] focus-within:outline-offset-[-2px] cursor-pointer ${isSelected ? 'bg-primary/5 dark:bg-primary-light/10' : ''}`}
                                tabIndex={0}
                                onClick={() => setSelectedUser({ type: 'invite', invite: inv })}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    setSelectedUser({ type: 'invite', invite: inv });
                                  }
                                }}
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
                                <td className="px-6 py-4">
                                  <div className="flex gap-1 flex-wrap">
                                    <span className="px-2 py-0.5 bg-primary/10 text-primary dark:text-primary-light rounded-full text-xs font-medium">
                                      {inv.role_preset}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-2">
                                    <select
                                      className="select select-sm select-bordered bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border-border dark:border-border-dark focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] transition-[border-color,box-shadow,outline] duration-[var(--aw-transition-fast)] ease-in-out cursor-pointer"
                                      value={inv.role_preset}
                                      onClick={(event) => event.stopPropagation()}
                                      onChange={(e) => handleInviteRoleChange(inv.inviteId, e.target.value)}
                                    >
                                      <option value="admin">Admin</option>
                                      <option value="editor">Editor</option>
                                      <option value="viewer">Viewer</option>
                                    </select>
                                    {inv.invite_url && (
                                      <Button
                                        size="xs"
                                        variant="outline"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          handleCopyInviteLink(inv.inviteId, inv.invite_url!);
                                        }}
                                      >
                                        {state.copyingInviteId === inv.inviteId ? 'Copied!' : 'Copy Link'}
                                      </Button>
                                    )}
                                    <IconButton
                                      tooltip="Delete invite"
                                      variant="error"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        dispatch({
                                          type: 'set-delete-confirm',
                                          value: {
                                            type: 'invite',
                                            id: inv.inviteId,
                                            label: inv.email,
                                          },
                                        });
                                      }}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </IconButton>
                                  </div>
                                </td>
                              </tr>
                            );
                        })}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            </Panel>
          </div>

          <div className="space-y-4">
            {selectedUser ? (
              <Card title={selectedTitle ?? 'Selected user'}>
                <div className="space-y-3">
                  {selectedUser.type === 'user' ? (
                    <>
                      <div>
                        <span className="text-xs text-text-muted dark:text-text-muted-dark">Name</span>
                        <p className="text-sm text-text-primary dark:text-text-primary-dark">
                          {selectedUser.user.display_name || 'No name set'}
                        </p>
                      </div>
                      <div>
                        <span className="text-xs text-text-muted dark:text-text-muted-dark">Email</span>
                        <p className="text-sm text-text-primary dark:text-text-primary-dark break-all">
                          {selectedUser.user.verified_email}
                        </p>
                      </div>
                      <div>
                        <span className="text-xs text-text-muted dark:text-text-muted-dark">Status</span>
                        <div className="mt-1">
                          {selectedUser.user.is_setup_complete ? (
                            <StatusBadge status="success" label="Active" />
                          ) : (
                            <StatusBadge status="warning" label="Pending" />
                          )}
                        </div>
                      </div>
                      <div>
                        <span className="text-xs text-text-muted dark:text-text-muted-dark">Roles</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {selectedUser.user.roles.map((roleName) => (
                            <span
                              key={roleName}
                              className="px-2 py-0.5 bg-primary/10 text-primary dark:text-primary-light rounded-full text-xs font-medium"
                            >
                              {roleName}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <span className="text-xs text-text-muted dark:text-text-muted-dark">Created</span>
                        <p className="text-sm text-text-primary dark:text-text-primary-dark">
                          {formatDate(selectedUser.user.created_at)}
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <span className="text-xs text-text-muted dark:text-text-muted-dark">Email</span>
                        <p className="text-sm text-text-primary dark:text-text-primary-dark break-all">
                          {selectedUser.invite.email}
                        </p>
                      </div>
                      <div>
                        <span className="text-xs text-text-muted dark:text-text-muted-dark">Status</span>
                        <div className="mt-1"><StatusBadge status="warning" label="Invited" /></div>
                      </div>
                      <div>
                        <span className="text-xs text-text-muted dark:text-text-muted-dark">Role</span>
                        <p className="text-sm text-text-primary dark:text-text-primary-dark">
                          {selectedUser.invite.role_preset}
                        </p>
                      </div>
                      <div>
                        <span className="text-xs text-text-muted dark:text-text-muted-dark">Created</span>
                        <p className="text-sm text-text-primary dark:text-text-primary-dark">
                          {formatDate(selectedUser.invite.created_at)}
                        </p>
                      </div>
                      <div>
                        <span className="text-xs text-text-muted dark:text-text-muted-dark">Expires</span>
                        <p className="text-sm text-text-primary dark:text-text-primary-dark">
                          {formatDate(selectedUser.invite.expires_at)}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </Card>
            ) : (
              <EmptyState
                icon={<Shield className="w-12 h-12 text-text-muted dark:text-text-muted-dark" strokeWidth={1.5} />}
                title="Select a user"
                description="Choose a user from the list to view details and manage roles."
              />
            )}
          </div>
        </div>
      </div>

      <InviteUserModal
        isOpen={state.inviteModalOpen}
        onClose={() => {
          dispatch({ type: 'set-invite-modal-open', value: false });
          void fetchUsers();
        }}
      />

      <ConfirmDialog
        open={!!state.deleteConfirm}
        onClose={() => dispatch({ type: 'set-delete-confirm', value: null })}
        onConfirm={handleDeleteConfirmed}
        title="Confirm Delete"
        message={
          <>
            Are you sure you want to delete{' '}
            <span className="font-medium text-text-primary dark:text-text-primary-dark">
              {state.deleteConfirm?.label}
            </span>
            ? This action cannot be undone.
          </>
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        intent="error"
        />
    </div>
  );
}
