/** Organization invite (list view — no raw token). */
export interface OrgInvite {
  inviteId: string;
  orgId: string;
  email: string;
  role: string;
  invited_by: string;
  created_at: string;
  expires_at: string;
  consumed: boolean;
  consumed_at: string | null;
}

/** Response at invite creation time — includes the one-time raw token. */
export interface OrgInviteCreate {
  inviteId: string;
  orgId: string;
  email: string;
  role: string;
  token: string;
  expires_at: string;
}
