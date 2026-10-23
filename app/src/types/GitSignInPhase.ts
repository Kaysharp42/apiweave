import type { GitAccountRef } from "@shared/types/GitAccountRef";

/**
 * Where a sign-in is: about to start, waiting for the tool to print its page,
 * waiting for the user in the browser (with a one-time code to enter, when the
 * host has a device flow), or over.
 */
export type GitSignInPhase =
  | { readonly kind: "ready" }
  | { readonly kind: "starting" }
  | { readonly kind: "browser"; readonly code: string | null; readonly url: string }
  | { readonly kind: "done"; readonly account: GitAccountRef }
  | { readonly kind: "failed"; readonly message: string };
