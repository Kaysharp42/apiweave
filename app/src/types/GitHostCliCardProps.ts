import type { GitHostCli } from "@shared/types/GitHostCli";
import type { GitProvider } from "@shared/types/GitProvider";
import type { GitAccountHostGroup } from "./GitAccountHostGroup";

export interface GitHostCliCardProps {
  readonly provider: GitProvider;
  /** The provider's tool as last listed; undefined when the list could not be read. */
  readonly cli: GitHostCli | undefined;
  /** This provider's accounts, by host. */
  readonly groups: readonly GitAccountHostGroup[];
  /** The names of the workspaces that sync as each account, by `gitAccountKey`. */
  readonly usedBy: ReadonlyMap<string, readonly string[]>;
  readonly onSignIn: () => void;
}
