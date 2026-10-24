import { useEffect, useState } from "react";
import type { GitAccount } from "@shared/types/GitAccount";
import type { GitHostCli } from "@shared/types/GitHostCli";
import { git } from "../utils/apiweaveClient";

/**
 * The accounts `gh` and `glab` are signed in to, and each tool's state, read
 * once when the caller mounts. `problems` says, in one line each, why a tool
 * that is installed could not answer — a broken install, a timeout, a token
 * gh reads from the environment — or why the list could not be read at all:
 * an empty picker must not be the only sign that something is wrong. A tool
 * that is simply missing is not a problem here.
 */
export function useGitAccounts(): {
  readonly accounts: readonly GitAccount[];
  readonly clis: readonly GitHostCli[];
  readonly problems: readonly string[];
} {
  const [accounts, setAccounts] = useState<readonly GitAccount[]>([]);
  const [clis, setClis] = useState<readonly GitHostCli[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    git
      .listAccounts()
      .then((list) => {
        if (!live) return;
        setAccounts(list.accounts);
        setClis(list.clis);
        setFailure(null);
      })
      .catch((error: unknown) => {
        if (live) setFailure(error instanceof Error ? error.message : String(error));
      });
    return () => {
      live = false;
    };
  }, []);
  const problems = [
    ...clis.flatMap((cli) => (cli.missing || cli.problem === null ? [] : [`${cli.command}: ${cli.problem}`])),
    ...(failure === null ? [] : [`Your gh and glab accounts could not be listed: ${failure}`]),
  ];
  return { accounts, clis, problems };
}
