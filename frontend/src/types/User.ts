import type { OAuthAccount } from './OAuthAccount';

export interface User {
  userId: string;
  verified_email: string;
  display_name: string | null;
  avatar_url: string | null;
  roles: string[];
  permissions: string[];
  oauth_accounts: OAuthAccount[];
  is_setup_complete: boolean;
  created_at: string;
}
