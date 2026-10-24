import { useEffect, useState } from "react";
import type { GitAccount } from "@shared/types/GitAccount";
import type { GitRepository } from "@shared/types/GitRepository";
import { useGitRepositoryList } from "./useGitRepositoryList";
import { gitAccountKey, gitAccountRef } from "../utils/gitAccounts";
import { remoteForRepository } from "../utils/gitRepositories";
import { HTTPS_REMOTE } from "../utils/gitRemote";
import type { GitRemotePickerProps, GitRemotePickerState, GitRemoteSelection } from "../types";

/** The account option that stands for none: a URL on any host, with the user's own git sign-in. */
const NO_ACCOUNT = "";

/** A typed URL, reached as the account when it is an `https://` one and the account signs in over HTTPS; the server checks the host. */
function typedRemote(url: string, account: GitAccount | null): GitRemoteSelection | null {
  const trimmed = url.trim();
  if (trimmed === "") return null;
  return { url: trimmed, account: account !== null && account.gitProtocol === "https" && HTTPS_REMOTE.test(trimmed) ? gitAccountRef(account) : null };
}

/** The account option a starting remote stands for: its account, or none; null when there is no starting remote. */
function initialAccountKey(initial: GitRemoteSelection | null): string | null {
  if (initial === null) return null;
  return initial.account === null ? NO_ACCOUNT : gitAccountKey(initial.account);
}

/** The account option shown: the one chosen, or until then the first account, so its list is there on opening. */
function shownAccountKey(chosen: string | null, accounts: readonly GitAccount[]): string {
  if (chosen !== null) return chosen;
  return accounts[0] === undefined ? NO_ACCOUNT : gitAccountKey(accounts[0]);
}

/** One string per remote, so a new object for the same choice is not a change. */
function selectionKey(selection: GitRemoteSelection | null): string {
  if (selection === null) return "";
  return `${selection.url}\n${selection.account === null ? "" : gitAccountKey(selection.account)}`;
}

/**
 * The remote picker's state: the accounts, the one shown and its list (or
 * the URL field standing in for it), what is chosen in either, and the
 * remote that comes to — told to `onChange` whenever it changes. A starting
 * remote opens on the URL field, filled in, with its account.
 */
export function useGitRemotePicker({ mode, initial, onChange, accounts: feed }: Pick<GitRemotePickerProps, "mode" | "initial" | "onChange" | "accounts">): GitRemotePickerState {
  const { accounts, clis, problems: accountProblems, loaded, reload } = feed;
  const [chosenKey, setChosenKey] = useState<string | null>(initialAccountKey(initial));
  const [urlMode, setUrlMode] = useState(initial !== null);
  const [url, setUrl] = useState(initial?.url ?? "");
  const [picked, setPicked] = useState<GitRepository | null>(null);
  const [showAll, setShowAll] = useState(false);

  const accountKey = shownAccountKey(chosenKey, accounts);
  const account = accounts.find((candidate) => gitAccountKey(candidate) === accountKey) ?? null;
  // Listing needs an account; without one, or asked for a URL, the URL field stands in.
  const listedAccount = urlMode ? null : account;
  const loadedList = useGitRepositoryList(listedAccount, { tagged: mode === "open" && !showAll, emptyOnly: mode === "connect" });
  // Asking again starts the choice over: what was picked belongs to the list being replaced.
  const list = { ...loadedList, refresh: () => { setPicked(null); loadedList.refresh(); } };

  const selection = listedAccount === null ? typedRemote(url, account) : picked && remoteForRepository(listedAccount, picked);
  const key = selectionKey(selection);
  useEffect(() => {
    onChange(selection);
    // The key is the selection; its object is new on every render.
  }, [key]);

  const chooseAccount = (chosen: string): void => {
    setChosenKey(chosen);
    setPicked(null);
    setUrlMode(chosen === NO_ACCOUNT);
  };

  return {
    accounts,
    clis,
    loaded,
    problems: [...accountProblems, ...list.problems],
    accountKey,
    account,
    listedAccount,
    list,
    picked,
    url,
    showAll,
    chooseAccount,
    signedIn: (signed) => {
      reload();
      chooseAccount(gitAccountKey(signed));
    },
    pick: setPicked,
    setUrl,
    toggleShowAll: () => {
      setShowAll(!showAll);
      setPicked(null);
    },
    showUrlField: setUrlMode,
  };
}
