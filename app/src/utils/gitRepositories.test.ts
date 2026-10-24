import { describe, expect, it } from "vitest";
import type { GitAccount } from "@shared/types/GitAccount";
import type { GitRepository } from "@shared/types/GitRepository";
import { remoteForRepository } from "./gitRepositories";

const ACCOUNT: GitAccount = {
  provider: "github",
  host: "github.com",
  login: "octo",
  gitProtocol: "https",
  active: true,
  problem: null,
};
const REPOSITORY: GitRepository = {
  owner: "acme",
  name: "tests",
  fullName: "acme/tests",
  httpsUrl: "https://github.com/acme/tests.git",
  sshUrl: "git@github.com:acme/tests.git",
  private: true,
  empty: true,
  canPush: true,
};

describe("remoteForRepository", () => {
  it("binds an https account to the repository's https URL", () => {
    expect(remoteForRepository(ACCOUNT, REPOSITORY)).toEqual({
      url: REPOSITORY.httpsUrl,
      account: { provider: "github", host: "github.com", login: "octo" },
    });
  });

  it("binds an SSH account to nothing, by the SSH URL", () => {
    expect(
      remoteForRepository({ ...ACCOUNT, gitProtocol: "ssh" }, REPOSITORY),
    ).toEqual({ url: REPOSITORY.sshUrl, account: null });
  });

  it("binds nothing when a host hands out a URL that is not https, as Phase 3 refuses any other", () => {
    expect(
      remoteForRepository(ACCOUNT, {
        ...REPOSITORY,
        httpsUrl: "http://git.example/acme/tests.git",
      }),
    ).toEqual({
      url: REPOSITORY.sshUrl,
      account: null,
    });
  });
});
