import { useCallback, useEffect, useRef, useState } from "react";
import type { GitAccountRef } from "@shared/types/GitAccountRef";
import type { GitRepositoryList } from "@shared/types/GitRepositoryList";
import type { GitRepositoryListRequest } from "@shared/types/GitRepositoryListRequest";
import { git } from "../utils/apiweaveClient";
import { gitAccountKey, gitAccountRef } from "../utils/gitAccounts";
import type { GitRepositoryListFeed } from "../types";

/**
 * An account's repositories, listed once per account and request for as
 * long as the caller is mounted — a dialog's life — and again on `refresh`.
 * Listing runs `gh`/`glab` against the host, once per GitHub organization,
 * so switching back to an account already listed costs nothing. A list that
 * could not be read is not kept: choosing the account again asks again.
 */
export function useGitRepositoryList(account: GitAccountRef | null, request: GitRepositoryListRequest): GitRepositoryListFeed {
  const key = account === null ? null : `${gitAccountKey(account)}|${String(request.tagged)}|${String(request.emptyOnly)}`;
  const cache = useRef(new Map<string, GitRepositoryList>());
  const [failure, setFailure] = useState<{ readonly key: string; readonly message: string } | null>(null);
  const [, setAnswered] = useState(0);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (account === null || key === null || cache.current.has(key)) return;
    let live = true;
    git
      .listRepositories(gitAccountRef(account), { tagged: request.tagged, emptyOnly: request.emptyOnly })
      .then((list) => {
        cache.current.set(key, list);
        if (!live) return;
        setFailure(null);
        setAnswered((count) => count + 1);
      })
      .catch((error: unknown) => {
        if (live) setFailure({ key, message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      live = false;
    };
    // The key names the account and the request; their objects may change identity on every render.
  }, [key, generation]);

  const refresh = useCallback(() => {
    if (key === null) return;
    cache.current.delete(key);
    setFailure(null);
    setGeneration((current) => current + 1);
  }, [key]);

  const list = key === null ? undefined : cache.current.get(key);
  const failed = failure !== null && failure.key === key ? failure.message : null;
  return {
    repositories: list?.repositories ?? [],
    problems: failed === null ? (list?.problems ?? []) : [`The repositories could not be listed: ${failed}`],
    loading: key !== null && list === undefined && failed === null,
    refresh,
  };
}
