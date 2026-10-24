import type { GitAccountRef } from "@shared/types/GitAccountRef";

/** A remote to connect to: its URL, and the account to reach it as — null for the user's own git sign-in. */
export interface GitRemoteSelection {
  readonly url: string;
  readonly account: GitAccountRef | null;
}
