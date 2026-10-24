import type { GitAccount } from "@shared/types/GitAccount";
import type { GitRepository } from "@shared/types/GitRepository";
import { gitAccountRef } from "./gitAccounts";
import { HTTPS_REMOTE } from "./gitRemote";
import type { GitRemoteSelection } from "../types";

/**
 * How to connect to `repository` as `account`: an HTTPS account gets the
 * HTTPS URL and is bound to it, so every sync uses its token; an SSH account
 * — or a host that hands out some other scheme — gets the SSH URL and no
 * binding, because an account is bound to an `https://` remote only, as
 * Phase 3 refuses any other, and the user's SSH key answers for SSH.
 */
export function remoteForRepository(account: GitAccount, repository: GitRepository): GitRemoteSelection {
  return account.gitProtocol === "https" && HTTPS_REMOTE.test(repository.httpsUrl)
    ? { url: repository.httpsUrl, account: gitAccountRef(account) }
    : { url: repository.sshUrl, account: null };
}

/** What to say when a repository was created but the workspace could not be connected to it: it stays, and connecting is retried by hand. */
export function connectFailedMessage(account: GitAccount, repository: GitRepository, reason: string): string {
  return `${account.host}/${repository.fullName} was created, but connecting this workspace to it failed. The repository was kept: connect to it from Version history to try again. Why: ${reason}`;
}
