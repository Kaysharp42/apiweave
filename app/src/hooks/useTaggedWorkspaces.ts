import { useCallback, useEffect, useState } from "react";
import type { GitAccountRef } from "@shared/types/GitAccountRef";
import type { GitRepositoryList } from "@shared/types/GitRepositoryList";
import { git } from "../utils/apiweaveClient";
import { gitAccountRef } from "../utils/gitAccounts";
import type { TaggedWorkspaceOutcome, TaggedWorkspacesFeed } from "../types";

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * What a finished sign-in offers to open: the account's tagged repositories
 * that hold a workspace not here yet, all ticked to start with. Nothing is
 * cloned until `openSelected`, which opens the ticked ones one at a time as
 * that account; main announces each open, so the workspace switcher picks it
 * up without this hook refreshing anything. `account` null — the sign-in has
 * not finished — asks for nothing.
 */
export function useTaggedWorkspaces(
  account: GitAccountRef | null,
): TaggedWorkspacesFeed {
  const [list, setList] = useState<GitRepositoryList | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [outcomes, setOutcomes] = useState<
    ReadonlyMap<string, TaggedWorkspaceOutcome>
  >(new Map());
  const [opening, setOpening] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (account === null) return;
    let live = true;
    git.listTaggedWorkspaces(gitAccountRef(account)).then(
      (listed) => {
        if (!live) return;
        setList(listed);
        setSelected(
          new Set(listed.repositories.map((repository) => repository.fullName)),
        );
      },
      (error: unknown) => {
        if (live) setFailure(messageOf(error));
      },
    );
    return () => {
      live = false;
    };
  }, [account]);

  const toggle = useCallback((fullName: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(fullName);
      else next.delete(fullName);
      return next;
    });
  }, []);

  const openSelected = async (): Promise<void> => {
    if (account === null || list === null) return;
    for (const repository of list.repositories) {
      if (!selected.has(repository.fullName)) continue;
      setOpening(repository.fullName);
      let outcome: TaggedWorkspaceOutcome;
      try {
        const result = await git.openFromGit(
          repository.httpsUrl,
          gitAccountRef(account),
        );
        outcome =
          result.kind === "opened"
            ? { kind: "opened", name: result.name, warnings: result.warnings }
            : { kind: "duplicate", name: result.name };
      } catch (error) {
        outcome = { kind: "failed", message: messageOf(error) };
      }
      setOutcomes((current) =>
        new Map(current).set(repository.fullName, outcome),
      );
    }
    setOpening(null);
    setFinished(true);
  };

  return {
    loading: account !== null && list === null && failure === null,
    failure,
    repositories: list?.repositories ?? [],
    problems: list?.problems ?? [],
    selected,
    toggle,
    outcomes,
    opening,
    finished,
    openSelected,
  };
}
