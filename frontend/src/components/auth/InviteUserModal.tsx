import React, { useState } from 'react';
import { Modal } from '../molecules/Modal';
import { FormField } from '../molecules/FormField';
import { Input } from '../atoms/Input';
import { Button } from '../atoms/Button';
import { authenticatedJson } from '../../utils/authenticatedApi';
import API_BASE_URL from '../../utils/api';
import type { InviteResponse } from '../../types';
import { toast } from 'sonner';

interface InviteUserModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function InviteUserModal({ isOpen, onClose }: InviteUserModalProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError('Email is required');
      return;
    }

    setLoading(true);
    setError(null);
    setInviteUrl(null);

    try {
      const response = await authenticatedJson<InviteResponse>(
        `${API_BASE_URL}/api/auth/invites`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email, roles: [role] }),
        }
      );
      setInviteUrl(response.invite_url);
      toast.success('Invite created successfully');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create invite';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const resetAndClose = () => {
    setEmail('');
    setRole('viewer');
    setError(null);
    setInviteUrl(null);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={resetAndClose}
      title="Invite User"
      size="sm"
      footer={
        !inviteUrl && (
          <>
            <Button variant="ghost" onClick={resetAndClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" form="invite-form" loading={loading}>
              Create Invite
            </Button>
          </>
        )
      }
    >
      <div className="p-5">
        {inviteUrl ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-primary dark:text-text-primary-dark">
              Invite link generated successfully! Share this link with the user.
            </p>
            <div className="bg-surface dark:bg-surface-dark p-3 rounded border border-border dark:border-border-dark flex items-center justify-between">
              <span className="text-sm font-mono truncate mr-2" title={inviteUrl}>
                {inviteUrl}
              </span>
              <Button
                size="xs"
                variant="secondary"
                onClick={() => {
                  navigator.clipboard.writeText(inviteUrl);
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
            <FormField label="Email Address" {...(error ? { error } : {})} required>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                disabled={loading}
              />
            </FormField>

            <FormField label="Role Preset" required>
              <select
                className="select select-bordered w-full bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border-border dark:border-border-dark"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={loading}
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
