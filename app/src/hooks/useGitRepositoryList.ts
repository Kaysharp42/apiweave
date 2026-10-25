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
 * so switching back to an account already listed costs nothing, and an
 * account switched away from and back to while its list is still coming
 * waits on that same ask rather than starting another.
 *
 * `refresh` asks again: the list it replaces is dropped, so an answer to an
 * earlier ask cannot land on top of the new one. While a list is being asked
 * for again, its old failure is not shown, and the list reads as loading.
 */
export function useGitRepositoryList(
  account: GitAccountRef | null,
  request: GitRepositoryListRequest,
): GitRepositoryListFeed {
  const key =
    account === null
      ? null
      : `${gitAccountKey(account)}|${String(request.tagged)}|${String(request.emptyOnly)}`;
  const cache = useRef(new Map<string, GitRepositoryList>());
  // The ask under way for each key: an effect that runs twice (React's strict mode) waits on the first.
  const pending = useRef(new Map<string, Promise<GitRepositoryList>>());
  const [failure, setFailure] = useState<{
    readonly key: string;
    readonly message: string;
  } | null>(null);
  const [, setAnswered] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (account === null || key === null) return;
    setFailure(null);
    if (cache.current.has(key)) return;
    let live = true;
    let asked = pending.current.get(key);
    if (asked === undefined) {
      const started = git.listRepositories(gitAccountRef(account), {
        tagged: request.tagged,
        emptyOnly: request.emptyOnly,
      });
      asked = started;
      pending.current.set(key, asked);
      // Once it is answered or refused, the next ask starts fresh; a refresh has already replaced it.
      const settle = (): void => {
        if (pending.current.get(key) === started) pending.current.delete(key);
      };
      void started.then(settle, settle);
    }
    asked.then(
      (list) => {
        if (!live) return;
        cache.current.set(key, list);
        setAnswered((count) => count + 1);
      },
      (error: unknown) => {
        if (live)
          setFailure({
            key,
            message: error instanceof Error ? error.message : String(error),
          });
      },
    );
    return () => {
      live = false;
    };
    // The key names the account and the request; their objects may change identity on every render.
  }, [key, attempt]);

  const refresh = useCallback(() => {
    if (key === null) return;
    cache.current.delete(key);
    pending.current.delete(key);
    setFailure(null);
    setAttempt((current) => current + 1);
  }, [key]);

  const list = key === null ? undefined : cache.current.get(key);
  const failed =
    failure !== null && failure.key === key ? failure.message : null;
  return {
    repositories: list?.repositories ?? [],
    problems:
      failed === null
        ? (list?.problems ?? [])
        : [`The repositories could not be listed: ${failed}`],
    failed: failed !== null,
    loading: key !== null && list === undefined && failed === null,
    refresh,
  };
}
