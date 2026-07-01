export interface InviteResponse {
  inviteId: string;
  email: string;
  role_preset: string;
  created_by: string;
  created_at?: string;
  expires_at: string;
  consumed: boolean;
  consumed_at?: string | null;
  invite_url: string | null;
  email_sent?: boolean;
  warning?: string;
}
