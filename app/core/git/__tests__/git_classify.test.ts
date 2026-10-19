import { describe, expect, it } from "vitest"
import { gitFailure } from "../git_classify"
import {
  GitAuthFailedError,
  GitCommandError,
  GitIdentityMissingError,
  GitNetworkError,
  GitNonFastForwardError,
  GitNotARepositoryError,
  GitNotInstalledError,
  GitPermissionDeniedError,
  failureDetails,
  gitInstallUrl,
  redactCredentials,
  type GitError,
} from "../git_errors"

type ErrorClass = new (...args: never[]) => GitError

function classify(stderr: string): GitError {
  return gitFailure("push", failureDetails(["push"], 128, "", stderr), gitInstallUrl("linux"))
}

/** Verbatim stderr, as GitHub, GitLab and Gitea print it. */
const FIXTURES: ReadonlyArray<readonly [string, ErrorClass, string]> = [
  [
    "git: no author configured, guessing disabled",
    GitIdentityMissingError,
    "Author identity unknown\n\n*** Please tell me who you are.\n\nRun\n\n  git config --global user.email \"you@example.com\"\n  git config --global user.name \"Your Name\"\n\nto set your account's default identity.\nOmit --global to set the identity only in this repository.\n\nfatal: no email was given and auto-detection is disabled\n",
  ],
  [
    "git: no author configured, guess refused",
    GitIdentityMissingError,
    "Committer identity unknown\n\n*** Please tell me who you are.\n\nfatal: unable to auto-detect email address (got 'ada@host.(none)')\n",
  ],
  [
    "GitHub: password rejected over https",
    GitAuthFailedError,
    "remote: Invalid username or token. Password authentication is not supported for Git operations.\nfatal: Authentication failed for 'https://github.com/acme/api.git/'\n",
  ],
  [
    "GitHub: password authentication removed",
    GitAuthFailedError,
    "remote: Support for password authentication was removed on August 13, 2021.\nremote: Please see https://docs.github.com/get-started/getting-started-with-git/about-remote-repositories#cloning-with-https-urls for information on currently recommended modes of authentication.\nfatal: Authentication failed for 'https://github.com/acme/api.git/'\n",
  ],
  [
    "GitHub: private repository without credentials, prompts off",
    GitAuthFailedError,
    "fatal: could not read Username for 'https://github.com': terminal prompts disabled\n",
  ],
  [
    "GitHub: repository hidden from this account",
    GitAuthFailedError,
    "remote: Repository not found.\nfatal: repository 'https://github.com/acme/secret.git/' not found\n",
  ],
  [
    "GitHub: ssh key refused",
    GitAuthFailedError,
    "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n",
  ],
  [
    "GitLab: wrong token",
    GitAuthFailedError,
    "remote: HTTP Basic: Access denied. The provided password or token is incorrect or your account has 2FA enabled and you must use a personal access token instead of a password.\nfatal: Authentication failed for 'https://gitlab.com/acme/api.git/'\n",
  ],
  [
    "GitLab: project hidden from this account",
    GitAuthFailedError,
    "remote: The project you were looking for could not be found or you don't have permission to view it.\nfatal: repository 'https://gitlab.com/acme/api.git/' not found\n",
  ],
  ["Gitea: wrong credentials", GitAuthFailedError, "remote: Unauthorized\nfatal: Authentication failed for 'https://gitea.example.com/acme/api.git/'\n"],
  ["Gitea: invalid credentials", GitAuthFailedError, "remote: invalid credentials\nfatal: Authentication failed for 'https://gitea.example.com/acme/api.git/'\n"],

  [
    "GitHub: token without write access",
    GitPermissionDeniedError,
    "remote: Permission to acme/api.git denied to octocat.\nfatal: unable to access 'https://github.com/acme/api.git/': The requested URL returned error: 403\n",
  ],
  [
    "GitHub: protected branch",
    GitPermissionDeniedError,
    "remote: error: GH006: Protected branch update failed for refs/heads/main.\nremote: error: Changes must be made through a pull request.\nTo https://github.com/acme/api.git\n ! [remote rejected] main -> main (protected branch hook declined)\nerror: failed to push some refs to 'https://github.com/acme/api.git'\n",
  ],
  [
    "GitHub: repository rules",
    GitPermissionDeniedError,
    "remote: error: GH013: Repository rule violations found for refs/heads/main.\nTo https://github.com/acme/api.git\n ! [remote rejected] main -> main (push declined due to repository rule violations)\n",
  ],
  [
    "GitLab: protected branch",
    GitPermissionDeniedError,
    "remote: GitLab: You are not allowed to push code to protected branches on this project.\nTo https://gitlab.com/acme/api.git\n ! [remote rejected] main -> main (pre-receive hook declined)\nerror: failed to push some refs to 'https://gitlab.com/acme/api.git'\n",
  ],
  [
    "GitLab: reporter role",
    GitPermissionDeniedError,
    "remote: You are not allowed to push code to this project.\nfatal: unable to access 'https://gitlab.com/acme/api.git/': The requested URL returned error: 403\n",
  ],
  [
    "Gitea: protected branch",
    GitPermissionDeniedError,
    "remote: Gitea: branch main is protected from force push\nTo https://gitea.example.com/acme/api.git\n ! [remote rejected] main -> main (pre-receive hook declined)\nerror: failed to push some refs to 'https://gitea.example.com/acme/api.git'\n",
  ],
  [
    "Gitea: no write permission",
    GitPermissionDeniedError,
    "remote: Gitea: User permission denied for writing.\nTo https://gitea.example.com/acme/api.git\n ! [remote rejected] main -> main (pre-receive hook declined)\n",
  ],

  [
    "non-fast-forward",
    GitNonFastForwardError,
    "To https://github.com/acme/api.git\n ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs to 'https://github.com/acme/api.git'\nhint: Updates were rejected because the tip of your current branch is behind\nhint: its remote counterpart. If you want to integrate the remote changes, use\nhint: 'git pull' before pushing again.\n",
  ],
  [
    "fetch first",
    GitNonFastForwardError,
    "To https://gitlab.com/acme/api.git\n ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to 'https://gitlab.com/acme/api.git'\nhint: Updates were rejected because the remote contains work that you do not\nhint: have locally.\n",
  ],

  [
    "DNS failure",
    GitNetworkError,
    "fatal: unable to access 'https://github.com/acme/api.git/': Could not resolve host: github.com\n",
  ],
  [
    "connection refused",
    GitNetworkError,
    "fatal: unable to access 'http://gitea.local:3000/acme/api.git/': Failed to connect to gitea.local port 3000 after 2045 ms: Couldn't connect to server\n",
  ],
  [
    "ssh timeout",
    GitNetworkError,
    "ssh: connect to host github.com port 22: Connection timed out\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n",
  ],
  [
    "ssh DNS failure",
    GitNetworkError,
    "ssh: Could not resolve hostname gitlab.example.com: Name or service not known\nfatal: Could not read from remote repository.\n",
  ],
  [
    "dropped mid-transfer",
    GitNetworkError,
    "error: RPC failed; curl 56 OpenSSL SSL_read: Connection was reset, errno 10054\nfatal: the remote end hung up unexpectedly\n",
  ],
  ["bad gateway", GitNetworkError, "fatal: unable to access 'https://gitlab.com/acme/api.git/': The requested URL returned error: 502\n"],

  ["outside a repository", GitNotARepositoryError, "fatal: not a git repository (or any of the parent directories): .git\n"],
  ["unrecognised failure", GitCommandError, "fatal: bad revision 'nope'\n"],
]

describe("stderr classification", () => {
  it.each(FIXTURES)("%s", (_name, expected, stderr) => {
    const error = classify(stderr)
    expect(error).toBeInstanceOf(expected)
    expect(error.name).toBe(expected.name)
  })

  it("does not take a local permission error for a refused push", () => {
    expect(classify("error: cannot open .git/FETCH_HEAD: Permission denied\n")).toBeInstanceOf(GitCommandError)
  })

  it("keeps the failing command, exit code and output on the error", () => {
    const error = classify("fatal: not a git repository (or any of the parent directories): .git\n")
    expect(error.message).toBe("git push failed: fatal: not a git repository (or any of the parent directories): .git")
    expect(error).toMatchObject({ code: "not_a_repository", details: { args: ["push"], exitCode: 128 } })
  })

  it("treats the macOS command-line-tools stub as not installed", () => {
    const error = gitFailure(
      "version",
      failureDetails(["version"], 1, "", "xcode-select: note: No developer tools were found, requesting install.\n"),
      gitInstallUrl("darwin"),
    )
    expect(error).toBeInstanceOf(GitNotInstalledError)
    expect((error as GitNotInstalledError).installUrl).toBe("https://git-scm.com/download/mac")
  })

  it("names an install link per OS", () => {
    expect(gitInstallUrl("win32")).toBe("https://git-scm.com/download/win")
    expect(gitInstallUrl("darwin")).toBe("https://git-scm.com/download/mac")
    expect(gitInstallUrl("linux")).toBe("https://git-scm.com/download/linux")
  })
})

describe("credential redaction", () => {
  it("strips userinfo from URLs in args and output", () => {
    expect(redactCredentials("fatal: unable to access 'https://octocat:ghp_secret@github.com/a/b.git/'")).toBe(
      "fatal: unable to access 'https://github.com/a/b.git/'",
    )
    const details = failureDetails(["clone", "https://user:tok@host/r.git"], 128, "", "https://user:tok@host/r.git")
    expect(JSON.stringify(details)).not.toContain("tok")
  })
})
