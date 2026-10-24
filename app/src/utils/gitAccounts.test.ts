import { describe, expect, it } from "vitest";
import type { GitAccount } from "@shared/types/GitAccount";
import { gitAccountInitials, gitAccountRef, groupGitAccountsByHost, sameGitAccount } from "./gitAccounts";

const account = (overrides: Partial<GitAccount>): GitAccount => ({
  provider: "github",
  host: "github.com",
  login: "octo",
  gitProtocol: "https",
  active: true,
  problem: null,
  ...overrides,
});

describe("gitAccountInitials", () => {
  it.each([
    ["octo-work", "OW"],
    ["Kaysharp42", "KA"],
    ["jane_doe.smith", "JD"],
    ["x", "X"],
  ])("reads %s as %s", (login, initials) => {
    expect(gitAccountInitials(login)).toBe(initials);
  });
});

describe("groupGitAccountsByHost", () => {
  it("groups by provider and host, GitHub first, keeping each host's order", () => {
    const groups = groupGitAccountsByHost([
      account({ provider: "gitlab", host: "gitlab.com", login: "tanuki" }),
      account({ login: "octo-work" }),
      account({ host: "ghe.example", login: "corp" }),
      account({ login: "octo-personal", active: false }),
    ]);

    expect(groups.map((group) => [group.host, group.accounts.map((listed) => listed.login)])).toEqual([
      ["ghe.example", ["corp"]],
      ["github.com", ["octo-work", "octo-personal"]],
      ["gitlab.com", ["tanuki"]],
    ]);
  });

  it("keeps a workspace's account that no tool lists any more, on its own host", () => {
    const bound = { provider: "gitlab" as const, host: "git.example", login: "gone" };

    const groups = groupGitAccountsByHost([account({})], bound);

    expect(groups.at(-1)).toEqual({ provider: "gitlab", host: "git.example", accounts: [], signedOut: bound });
    expect(groupGitAccountsByHost([account({})], gitAccountRef(account({})))[0]?.signedOut).toBeNull();
  });
});

describe("sameGitAccount", () => {
  it("compares provider, host and login, and never matches null", () => {
    expect(sameGitAccount(account({}), gitAccountRef(account({})))).toBe(true);
    expect(sameGitAccount(account({}), account({ host: "ghe.example" }))).toBe(false);
    expect(sameGitAccount(null, null)).toBe(false);
  });
});
