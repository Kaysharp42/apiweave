import type { OAuthAccount } from "./OAuthAccount";

export interface UserAccount {
  id: string;
  email: string;
  provider: "local" | "github" | "gitlab" | "google" | "microsoft";
  oauthAccounts: OAuthAccount[];
}
