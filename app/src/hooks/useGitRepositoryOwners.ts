import { useEffect, useState } from "react";
import type { GitAccountRef } from "@shared/types/GitAccountRef";
import type { GitRepositoryOwnerList } from "@shared/types/GitRepositoryOwnerList";
import { git } from "../utils/apiweaveClient";
import { gitAccountKey, gitAccountRef } from "../utils/gitAccounts";
import type { GitRepositoryOwnersFeed } from "../types";

/**
 * Where `account` can create a repository — itself and its organizations or
 * groups — asked for whenever the account changes. An account its tool
 * cannot hand over lists no owner, and `problem` says why.
 */
export function useGitRepositoryOwners(account: GitAccountRef | null): GitRepositoryOwnersFeed {
  const key = account === null ? null : gitAccountKey(account);
  const [answer, setAnswer] = useState<{ readonly key: string; readonly list: GitRepositoryOwnerList } | null>(null);

  useEffect(() => {
    if (account === null || key === null) return;
    let live = true;
    git
      .listOwners(gitAccountRef(account))
      .then((list) => {
        if (live) setAnswer({ key, list });
      })
      .catch((error: unknown) => {
        if (live) setAnswer({ key, list: { owners: [], problem: error instanceof Error ? error.message : String(error) } });
      });
    return () => {
      live = false;
    };
    // The key names the account; the object itself may change identity on every render.
  }, [key]);

  const current = answer !== null && answer.key === key ? answer.list : null;
  return { owners: current?.owners ?? [], problem: current?.problem ?? null, loading: key !== null && current === null };
}
