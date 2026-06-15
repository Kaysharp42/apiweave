export interface Invite {
  id: string;
  email: string;
  role: string;
  token?: string;
  expiresAt: string;
  createdAt: string;
  invitedBy: string;
}
