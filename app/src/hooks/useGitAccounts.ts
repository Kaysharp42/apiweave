import { useEffect, useState } from "react";
import type { GitAccount } from "@shared/types/GitAccount";
import { git } from "../utils/apiweaveClient";

/**
 * The accounts `gh` and `glab` are signed in to, read once when the caller
 * mounts. Empty until they arrive, and when neither tool is installed or the
 * list cannot be read: a picker with nothing to offer is simply not shown.
 */
export function useGitAccounts(): readonly GitAccount[] {
  const [accounts, setAccounts] = useState<readonly GitAccount[]>([]);
  useEffect(() => {
    let live = true;
    git
      .listAccounts()
      .then((list) => {
        if (live) setAccounts(list.accounts);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return accounts;
}
