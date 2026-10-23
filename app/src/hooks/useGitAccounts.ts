import { useCallback, useEffect, useState } from "react";
import type { GitAccount } from "@shared/types/GitAccount";
import { git } from "../utils/apiweaveClient";

/**
 * The accounts `gh` and `glab` are signed in to, read when the caller mounts
 * and again on `reload` — after a sign-in, say. Empty until they arrive, and
 * when neither tool is installed or the list cannot be read: a picker with
 * nothing to offer is simply not shown.
 */
export function useGitAccounts(): { readonly accounts: readonly GitAccount[]; readonly reload: () => void } {
  const [accounts, setAccounts] = useState<readonly GitAccount[]>([]);
  const [generation, setGeneration] = useState(0);
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
  }, [generation]);
  const reload = useCallback(() => setGeneration((current) => current + 1), []);
  return { accounts, reload };
}
