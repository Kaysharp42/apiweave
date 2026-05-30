export interface User {
  userId: string;
  verified_email: string;
  display_name: string | null;
  avatar_url: string | null;
  roles: string[];
  permissions: string[];
  is_setup_complete: boolean;
  created_at: string;
}
