import { useCallback, useEffect, useState } from "react";
import type { GitAccount } from "@shared/types/GitAccount";
import type { GitHostCli } from "@shared/types/GitHostCli";
import { git } from "../utils/apiweaveClient";
import { cliProblemLine } from "../utils/gitAccounts";

/**
 * The accounts `gh` and `glab` are signed in to, and each tool's state, read
 * when the caller mounts and again on `reload` — after a sign-in, say.
 * `problems` says, in one line each, why a tool that is installed could not
 * answer — a broken install, a timeout, a token gh reads from the
 * environment — or why the list could not be read at all, which is also
 * `failure` on its own: an empty picker must not be the only sign that
 * something is wrong. A tool that is simply missing is not a problem here.
 * `loaded` is false until the first answer, so "no accounts" is never said
 * while the tools are still being asked; `loading` is true while any ask,
 * a reload's included, is under way.
 */
export function useGitAccounts(): {
  readonly accounts: readonly GitAccount[];
  readonly clis: readonly GitHostCli[];
  readonly problems: readonly string[];
  readonly failure: string | null;
  readonly loaded: boolean;
  readonly loading: boolean;
  readonly reload: () => void;
} {
  const [accounts, setAccounts] = useState<readonly GitAccount[]>([]);
  const [clis, setClis] = useState<readonly GitHostCli[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  // The generation last answered; behind `generation` while an ask is under way.
  const [answered, setAnswered] = useState(-1);
  const [generation, setGeneration] = useState(0);
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
      })
      .finally(() => {
        if (live) setAnswered(generation);
      });
    return () => {
      live = false;
    };
  }, [generation]);
  const reload = useCallback(() => setGeneration((current) => current + 1), []);
  const problems = [
    ...clis.flatMap((cli) => (cli.missing || cli.problem === null ? [] : [cliProblemLine(cli.command, cli.problem)])),
    ...(failure === null ? [] : [`Your gh and glab accounts could not be listed: ${failure}`]),
  ];
  return { accounts, clis, problems, failure, loaded: answered >= 0, loading: answered !== generation, reload };
}
