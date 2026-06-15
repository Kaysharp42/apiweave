import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { authenticatedJson, authenticatedFetch } from '../utils/authenticatedApi';
import API_BASE_URL from '../utils/api';
import type { Invite, InviteResponse } from '../types';

/** Map a backend InviteResponse to the frontend Invite shape. */
function toInvite(r: InviteResponse): Invite {
  return {
    id: r.inviteId,
    email: r.email,
    role: r.role_preset,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    invitedBy: r.created_by,
  };
}

interface CreateInviteResult {
  invite: Invite;
  warning?: string;
  link?: string;
}

export function useInvites() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInvites = useCallback(async () => {
    try {
      setLoading(true);
      const data = await authenticatedJson<InviteResponse[]>(`${API_BASE_URL}/api/auth/invites`);
      const now = new Date();
      const pending = data
        .filter((inv) => !inv.consumed && new Date(inv.expires_at) > now)
        .map(toInvite);
      setInvites(pending);
    } catch {
      toast.error('Failed to load invites');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchInvites();
  }, [fetchInvites]);

  const createInvite = useCallback(
    async (email: string, role: string): Promise<CreateInviteResult | null> => {
      try {
        const response = await authenticatedJson<InviteResponse>(
          `${API_BASE_URL}/api/auth/invites`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, roles: [role] }),
          },
        );

        const invite = toInvite(response);
        setInvites((prev) => [...prev, invite]);

        const result: CreateInviteResult = { invite };

        // If SMTP is not configured the backend returns the link directly
        if (response.invite_url) {
          result.link = response.invite_url;
          result.warning = 'email not sent';
        }

        toast.success('Invite created successfully');
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to create invite';
        toast.error(msg);
        return null;
      }
    },
    [],
  );

  const revokeInvite = useCallback(async (inviteId: string): Promise<boolean> => {
    try {
      await authenticatedFetch(`${API_BASE_URL}/api/invites/${inviteId}`, {
        method: 'DELETE',
      });
      setInvites((prev) => prev.filter((inv) => inv.id !== inviteId));
      toast.success('Invite revoked');
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to revoke invite';
      toast.error(msg);
      return false;
    }
  }, []);

  return { invites, loading, fetchInvites, createInvite, revokeInvite };
}
