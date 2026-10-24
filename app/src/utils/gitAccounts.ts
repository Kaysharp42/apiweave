import type { GitAccount } from "@shared/types/GitAccount";
import type { GitAccountRef } from "@shared/types/GitAccountRef";
import type { GitProvider } from "@shared/types/GitProvider";
import type { GitAccountHostGroup } from "../types";

/** What each provider and its command-line tool are called, and where the tool is installed from. */
export const GIT_PROVIDERS: Readonly<
  Record<
    GitProvider,
    { readonly name: string; readonly command: "gh" | "glab"; readonly cliName: string; readonly defaultHost: string; readonly installUrl: string }
  >
> = {
  github: { name: "GitHub", command: "gh", cliName: "GitHub CLI (gh)", defaultHost: "github.com", installUrl: "https://cli.github.com" },
  gitlab: { name: "GitLab", command: "glab", cliName: "GitLab CLI (glab)", defaultHost: "gitlab.com", installUrl: "https://gitlab.com/gitlab-org/cli" },
};

/** A tool's problem as one line naming the tool, unless the tool's own words already start with its name. */
export function cliProblemLine(command: string, problem: string): string {
  return new RegExp(`^${command}\\b`).test(problem) ? problem : `${command}: ${problem}`;
}

/** One string per account, for keys, option values and comparisons. */
export const gitAccountKey = (account: GitAccountRef): string =>
  `${account.provider}|${account.host}|${account.login}`;

export const sameGitAccount = (a: GitAccountRef | null, b: GitAccountRef | null): boolean =>
  a !== null && b !== null && gitAccountKey(a) === gitAccountKey(b);

/** Only what names the account: the bridge refuses anything more. */
export const gitAccountRef = ({ provider, host, login }: GitAccountRef): GitAccountRef => ({ provider, host, login });

/**
 * Up to two letters for an account's login: the first letter of each of its
 * first two words (`octo-work` → `OW`), or its first two characters when it is
 * one word (`Kaysharp42` → `KA`).
 */
export function gitAccountInitials(login: string): string {
  const words = login.split(/[-_.]+/).filter((word) => word !== "");
  const initials = words.length > 1 ? words.slice(0, 2).map((word) => word[0]).join("") : login.slice(0, 2);
  return initials.toUpperCase();
}

/**
 * Accounts grouped by provider and host, GitHub first and each host's
 * accounts in the order the tools listed them. A bound account no tool lists
 * any more (`extra`) joins its host's group, so it is still shown.
 */
export function groupGitAccountsByHost(
  accounts: readonly GitAccount[],
  extra: GitAccountRef | null = null,
): readonly GitAccountHostGroup[] {
  const groups = new Map<string, { provider: GitProvider; host: string; accounts: GitAccount[]; signedOut: GitAccountRef | null }>();
  const groupOf = (account: GitAccountRef) => {
    const key = `${account.provider}|${account.host}`;
    const group = groups.get(key) ?? { provider: account.provider, host: account.host, accounts: [], signedOut: null };
    groups.set(key, group);
    return group;
  };
  for (const account of accounts) groupOf(account).accounts.push(account);
  if (extra !== null && !accounts.some((account) => sameGitAccount(account, extra))) groupOf(extra).signedOut = gitAccountRef(extra);
  return [...groups.values()].sort((a, b) =>
    a.provider === b.provider ? a.host.localeCompare(b.host) : a.provider === "github" ? -1 : 1,
  );
}
