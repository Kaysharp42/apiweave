import React, { useReducer } from 'react';
import { Modal } from '../molecules/Modal';
import { FormField } from '../molecules/FormField';
import { Input } from '../atoms/Input';
import { Button } from '../atoms/Button';
import { authenticatedJson } from '../../utils/authenticatedApi';
import API_BASE_URL from '../../utils/api';
import type { InviteResponse, InviteUserModalProps } from '../../types';
import { toast } from 'sonner';

export function InviteUserModal({ isOpen, onClose }: InviteUserModalProps) {
  type InviteState = {
    email: string;
    role: string;
    loading: boolean;
    error: string | null;
    inviteUrl: string | null;
  };

  type InviteAction =
    | { type: 'set-email'; value: string }
    | { type: 'set-role'; value: string }
    | { type: 'set-loading'; value: boolean }
    | { type: 'set-error'; value: string | null }
    | { type: 'set-invite-url'; value: string | null }
    | { type: 'reset' };

  const [state, dispatch] = useReducer((current: InviteState, action: InviteAction): InviteState => {
    switch (action.type) {
      case 'set-email':
        return { ...current, email: action.value };
      case 'set-role':
        return { ...current, role: action.value };
      case 'set-loading':
        return { ...current, loading: action.value };
      case 'set-error':
        return { ...current, error: action.value };
      case 'set-invite-url':
        return { ...current, inviteUrl: action.value };
      case 'reset':
        return { email: '', role: 'viewer', loading: false, error: null, inviteUrl: null };
      default:
        return current;
    }
  }, { email: '', role: 'viewer', loading: false, error: null, inviteUrl: null });

  const setEmail = (value: string): void => {
    dispatch({ type: 'set-email', value });
  };

  const setRole = (value: string): void => {
    dispatch({ type: 'set-role', value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!state.email) {
      dispatch({ type: 'set-error', value: 'Email is required' });
      return;
    }

    dispatch({ type: 'set-loading', value: true });
    dispatch({ type: 'set-error', value: null });
    dispatch({ type: 'set-invite-url', value: null });

    try {
      const response = await authenticatedJson<InviteResponse>(
        `${API_BASE_URL}/api/auth/invites`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email: state.email, roles: [state.role] }),
        }
      );
      dispatch({ type: 'set-invite-url', value: response.invite_url });
      toast.success('Invite created successfully');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create invite';
      dispatch({ type: 'set-error', value: msg });
    } finally {
      dispatch({ type: 'set-loading', value: false });
    }
  };

  const resetAndClose = () => {
    setEmail('');
    setRole('viewer');
    dispatch({ type: 'reset' });
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={resetAndClose}
      title="Invite User"
      size="sm"
      footer={() => (
        !state.inviteUrl ? (
          <>
            <Button variant="ghost" onClick={resetAndClose} disabled={state.loading}>
              Cancel
            </Button>
            <Button type="submit" form="invite-form" loading={state.loading}>
              Create Invite
            </Button>
          </>
        ) : null
      )}
    >
      <div className="p-5">
        {state.inviteUrl ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-primary dark:text-text-primary-dark">
              Invite link generated successfully! Share this link with the user.
            </p>
            <div className="bg-surface dark:bg-surface-dark p-3 rounded border border-border dark:border-border-dark flex items-center justify-between">
                <span className="text-sm font-mono truncate mr-2" title={state.inviteUrl}>
                {state.inviteUrl}
                </span>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => {
                    if (!state.inviteUrl) return;
                    navigator.clipboard.writeText(state.inviteUrl);
                    toast.success('Copied to clipboard');
                  }}
                >
                Copy
              </Button>
            </div>
            <div className="flex justify-end mt-4">
              <Button onClick={resetAndClose}>Close</Button>
            </div>
          </div>
        ) : (
            <form id="invite-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
            <FormField label="Email Address" {...(state.error ? { error: state.error } : {})} required>
              <Input
                type="email"
                value={state.email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                disabled={state.loading}
              />
            </FormField>

            <FormField label="Role Preset" required>
              <select
                className="select select-bordered w-full bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border-border dark:border-border-dark focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] transition-[border-color,box-shadow,outline] duration-[var(--aw-transition-fast)] ease-in-out cursor-pointer"
                value={state.role}
                onChange={(e) => setRole(e.target.value)}
                disabled={state.loading}
              >
                <option value="admin">Admin</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
            </FormField>
          </form>
        )}
      </div>
    </Modal>
  );
}
