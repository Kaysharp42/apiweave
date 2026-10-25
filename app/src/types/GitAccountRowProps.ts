import type { ReactNode } from "react";
import type { GitAccount } from "@shared/types/GitAccount";
import type { GitAccountRef } from "@shared/types/GitAccountRef";

export interface GitAccountRowProps {
  /** A listed account, or the bare reference of one a workspace uses that no tool lists any more. */
  readonly account: GitAccount | GitAccountRef;
  /** The current workspace reaches its remote as this account. */
  readonly current?: boolean;
  /** A further line under the account, such as which workspaces use it. */
  readonly detail?: ReactNode;
}
