import { useState, useEffect, useCallback } from 'react';
import { Button } from '../components/atoms/Button';
import { StatusBadge } from '../components/molecules/StatusBadge';
import { InviteUserModal } from '../components/auth/InviteUserModal';
import { authenticatedJson } from '../utils/authenticatedApi';
import API_BASE_URL from '../utils/api';
import type { User } from '../types';
import { toast } from 'sonner';
import { Loader2, Shield } from 'lucide-react';
import { useAuth } from '../auth/useAuth';

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await authenticatedJson<User[]>(`${API_BASE_URL}/api/users`);
      setUsers(data);
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
    // Basic protection against removing oneself as last admin
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
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-text-muted">
                        No users found
                      </td>
                    </tr>
                  ) : (
                    users.map((user) => {
                      const primaryRole = user.roles.includes('admin')
                        ? 'admin'
                        : user.roles.includes('editor')
                        ? 'editor'
                        : 'viewer';

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
                            <select
                              className="select select-sm select-bordered bg-surface dark:bg-surface-dark"
                              value={primaryRole}
                              onChange={(e) => handleRoleChange(user.userId, e.target.value)}
                            >
                              <option value="admin">Admin</option>
                              <option value="editor">Editor</option>
                              <option value="viewer">Viewer</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })
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
    </>
  );
}
