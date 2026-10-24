import type { GitAccount } from "@shared/types/GitAccount";
import type { GitRemoteSelection } from "./GitRemoteSelection";

/**
 * Where Version history's Create repository stands: nothing under way, its
 * dialog open for the account Create repository… was chosen under, or a
 * repository created that could not be connected to, whose remote the
 * connect form starts with.
 */
export type GitRepositoryCreation =
  | { readonly step: "idle" }
  | { readonly step: "dialog"; readonly account: GitAccount }
  | { readonly step: "unconnected"; readonly remote: GitRemoteSelection };
