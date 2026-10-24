import type { GitHostCli } from "@shared/types/GitHostCli";

export interface GitCliStateProps {
  /** The tool as last listed; nothing is said while it has not been. */
  readonly cli: GitHostCli | undefined;
}
