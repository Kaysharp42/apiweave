import type { GitAccount } from "@shared/types/GitAccount";

export interface GitRemoteAccountSelectProps {
  readonly accounts: readonly GitAccount[];
  /** The chosen account's `gitAccountKey`, or the empty string for another host with the user's own git sign-in. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled: boolean;
}
