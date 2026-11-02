# Git accounts, sync icons and the sync tutorial

Follows the git-sync plan (`git-sync-plan.md`), shipped in v0.20.0. Not to be
committed: `docs/plans/` stays out of git.

## 1. Goal

1. **Tutorial.** The in-app tutorial teaches version history and sync: track a
   workspace, commit, connect a remote, sync, open on a second machine, resolve
   a merge, run the repository in CI.
2. **Accounts.** A user connects their GitHub and GitLab accounts from the
   header, where the Cloud account menu used to be. APIWeave signs them in, lets
   each workspace use a specific account, and can create the repository for a
   workspace, from **Create workspace** or later from Version history.
3. **Icons.** Every workspace shows whether it is synced: in the header and in
   the workspace switcher.

## 2. Decisions (made by the user, 2026-10-22)

- **Icons are coloured by state**, not a fixed brand orange: success when
  synced, muted when local only, info while syncing or with work pending,
  warning or error when the user must act.
- **APIWeave runs the sign-in itself** (`gh auth login --web`,
  `glab auth login --web`) and shows the one-time code in the app. The user
  never has to open a terminal.
- **GitHub and GitLab ship in the same round.**
- **Multiple accounts are supported.** For GitHub, several accounts on one host,
  as `gh` allows. For GitLab, one account per host, because `glab` stores one
  token per host; two GitLab accounts need two hosts. The UI says so instead of
  offering a second login it would overwrite.
- **Every phase is built by its own subagent, as stacked PRs**, reviewed before
  merge, merged by the user.
- **Any other git host** (Bitbucket, Gitea, self-hosted without `gh`/`glab`)
  keeps today's flow: create an empty repository, paste its URL. There is no
  common create-repository API to build on.

## 3. Facts the design rests on (verified 2026-10-22)

- `gh` 2.97 on the dev machine. `gh auth status --json hosts` lists every
  account per host with `login`, `active`, `state`, `scopes`, `gitProtocol` and
  `tokenSource`. `gh auth token --hostname H --user L` prints one account's
  token. `GH_TOKEN` in a child's environment makes that one `gh` call act as the
  account, without touching which account is active.
- `gh auth login` flags: `--web`, `--hostname`, `--git-protocol`,
  `--skip-ssh-key`, `--clipboard`, `--scopes`.
- `glab auth status --all --output json` lists configured hosts;
  `--show-token` prints the token. `glab auth login --hostname H --web` and
  `--device` (GitLab 17.9+). `glab repo create <path> --private --skipGitInit`
  creates a project without touching the current directory. `GITLAB_TOKEN` and
  `GITLAB_HOST` in the environment override stored credentials and host.
- **The multi-account bug today.** The user's global git config sets
  `credential.https://github.com.helper` to `gh auth git-credential`, which
  answers with the **active** `gh` account. A workspace whose repository
  belongs to the other account pushes as the wrong user and fails. Phase 3
  fixes it.
- Every git call goes through `GitService.run`
  (`app/core/git/git_service.ts:504`), which prefixes `gitConfigArgs` and runs
  with `this.env`. `fetch`, `push` and `clone` are at lines 363-391.
- Git operations are a privileged bridge (`__APIWEAVE_GIT__`,
  `app/electron/git_sync.ts`, behind `requireTrustedSender`), never on the IPC
  router and never on MCP. Status reaches the renderer through
  `useWorkspaceGitStatus(workspaceId)` and the `apiweave:git-status-changed`
  event.
- The tutorial is typed data under `app/src/constants/tutorials/`, ordered by
  `curriculum.ts`, guarded by `curriculum.test.ts` (exact lesson id list,
  content minimums). Lesson ids are persisted and never change once shipped.
  There is no git lesson today.
- `MainHeader.tsx` `navbar-end`: `GitSyncControl`, tutorials, auto-save, theme.
  The Cloud `AccountMenu` sat after the theme toggle until `e955d5ff`.
- `OrgWorkspaceSwitcher.tsx` rows show a `UserRound`/`HardDrive` tile and a
  subtitle; no sync state.
- Latest migration: `026_merge_picks.sql`.

## 4. Target design

### 4.1 Status vocabulary (Phase 2)

One function maps a `WorkspaceGitStatus` to a **sync kind**, used by the
header, the switcher and Version history alike:

| kind | when | icon (lucide) | intent |
|---|---|---|---|
| `untracked` | not tracked | none in the header; switcher keeps its tile | — |
| `local` | tracked, no remote, nothing uncommitted | `HardDrive` | muted |
| `synced` | remote, nothing to push or pull, idle | `CloudCheck` | success |
| `pending` | uncommitted or outgoing or incoming | `CloudUpload` / `CloudDownload` | info |
| `syncing` | state `syncing` | `RefreshCw`, spinning | info |
| `attention` | `merging`, `diverged`, read-only | `CloudAlert` | warning |
| `error` | state `error` | `CloudAlert` | error |

Confirm each icon exists in the installed `lucide-react` before using it.
Colours come from tokens (`text-status-*`, `text-text-muted`), never hex.

The header label for a local-only workspace stops saying **Committed**. It
says **Local history** (and **Local history · uncommitted** when relevant),
and **Commit now** is only offered when there is something to commit. No count:
`uncommitted` is a flag, because counting would serialize the whole workspace
on every status read (accepted in the #130 review).

### 4.2 Accounts (Phase 3)

A **git account** is `{ provider: "github" | "gitlab", host, login,
gitProtocol }`. APIWeave never stores a token: `gh` and `glab` keep them in the
OS keyring, and APIWeave asks for one per operation.

- **`HostCliService`** (`app/core/git/accounts/`), injectable like
  `GitService` (a runner function, so tests use a fake), Electron-free:
  - `detect()`: is `gh`/`glab` on PATH (use the login-shell PATH helper the
    agents already use), and its version.
  - `listAccounts()`: parses `gh auth status --json hosts` and
    `glab auth status --all --output json`. A missing CLI yields no accounts and
    a `missing` flag, never an error.
  - `token(account)`: `gh auth token --hostname H --user L`;
    `glab auth status --hostname H --show-token` (parse). Held only in memory,
    for the one child process that needs it.
  - `signIn(provider, host)`: Phase 3.3.
  - `createRepository(...)`: Phase 4.2.
- **Per-workspace account.** Migration `027` adds nullable `account_provider`,
  `account_host`, `account_login` to `workspace_git`. Machine-local: never
  written to the repository, never exported, never shown to MCP.
- **Per-call credentials.** `GitService.fetch`, `push` and `clone` take an
  optional `credential: { username, password }`. When present, the call adds
  `-c credential.helper=` (which clears every helper read so far, including
  the URL-scoped `gh` one) then `-c credential.helper=<helper>`, where the
  helper prints `username=` and `password=` from an environment variable set
  only on that child (`APIWEAVE_GIT_PASSWORD`). The token is never in argv,
  never on disk, never in the database, never in an error message
  (`redactCredentials` already scrubs URLs; extend it to the env value).
  Username: `x-access-token` for GitHub, `oauth2` for GitLab. Prove it works
  with a test against a local HTTP server or a fake helper, **on Windows CI
  too**: Git for Windows runs `!` helpers through its bundled `sh`.
- **When no account is bound**, nothing changes: the user's own helpers and SSH
  keys apply, as in 0.20.0.
- **SSH-protocol accounts** get SSH URLs and no injected credential; which key
  answers is the user's SSH config.
- **Sign-in (3.3).** Main runs `gh auth login --hostname H --web
  --git-protocol https --skip-ssh-key` (or `glab auth login --hostname H
  --web`), with no TTY. It parses the one-time code and URL from the output,
  sends them to the renderer, opens the URL with `shell.openExternal`, and
  waits for the process to exit. Cancel kills the process tree. Verify first,
  with the real CLIs, how each behaves without a TTY (prompts, "press Enter",
  whether `gh` edits the user's global git config), and document what it does.
  If a CLI cannot complete without a TTY, run it in the PTY host instead.
- **Security boundary.** Accounts, tokens, sign-in and repository creation are
  methods on the existing `__APIWEAVE_GIT__` bridge, behind
  `requireTrustedSender`, off the router and off MCP. An agent that could pick
  an account could push a workspace anywhere that account can write, and one
  that could create repositories could publish a workspace.

### 4.3 Header and creation (Phase 4)

- **Accounts menu** in `MainHeader`, after the theme toggle, where
  `AccountMenu` used to be. Trigger: the current workspace's account initials
  (or a neutral `UserRound` when it has none), with the sync icon as a corner
  badge. Panel: accounts grouped by host, which one the current workspace uses,
  **Add GitHub account**, **Add GitLab account**, and a link to
  **Settings > Git accounts**. Built from existing atoms (`Button`,
  `IconButton`, `Card`), Headless UI `Popover` like `GitSyncControl`. No brand
  logo dependency.
- **Settings > Git accounts**: the same list with detail: CLI found or not,
  with an install link when missing; sign in; which workspaces use each
  account.
- **Create repository**: in Version history, next to **Connect to remote**:
  pick account, owner (the account or one of its orgs/groups), name (defaults to
  the workspace slug), visibility (private by default). Creates an **empty**
  repository (no README, so `joinRemote` accepts it), then connects with the
  account bound. A name that already exists is an error naming it, never a
  silent connect to someone else's repository. If the repository is created but
  connecting fails, the error says so and offers **Connect to remote** with the
  new URL; APIWeave never deletes a remote repository.
- **Create workspace** gets an optional **Sync with a git host** section with
  the same fields, off by default. On submit: create the workspace, track it,
  create the repository, connect. A failure after the workspace exists leaves
  the workspace created and tracked, with the error and a retry in Version
  history.
- **Open from git** gets an account picker, so a private repository clones as
  the right account.
- **Repository picker** (added by the user, 2026-10-24). Every form that takes
  a remote asks **Account** first, then **Repository** from a dropdown, with
  **Use a URL instead** for other hosts or anything not listed. The URL-first
  form, where the account picker only appears after `https://` is typed, goes.
  - Repositories APIWeave creates get the topic `apiweave-workspace` (GitHub
    topic, GitLab topic). APIWeave cannot cheaply tell a workspace repository
    by its content, so the topic is what "an APIWeave repository" means; a
    repository made elsewhere joins by adding the topic. A **Show all
    repositories** switch lists the rest.
  - **Connect** (Version history) lists the account's **empty** repositories
    it can push to, because `joinRemote` refuses one holding another history,
    with **Create repository…** first.
  - **Open from git** lists the account's repositories with the topic.
  - Listing: `gh repo list <owner> --topic apiweave-workspace --no-archived
    --json name,nameWithOwner,url,isEmpty,viewerPermission,visibility` for the
    account and each org (`GH_TOKEN` of that account); GitLab
    `projects?membership=true&topic=apiweave-workspace&archived=false`
    (`empty_repo`, `permissions`) through `glab api`. Paged, capped, cached
    per account for the life of the dialog, refreshable.

## 5. Stacked PR workflow

Same conventions as `git-sync-plan.md` §4, with branch prefix
`git-accounts/<phase>.<n>-<slug>` and these changes from the v0.20.0 lesson:

- **Independent phases start from `main`**, not from the phase below. Phase 1
  and Phase 2 each start from `main`; Phase 3 starts from `main`; Phase 4
  stacks on Phase 3; Phase 5 stacks on Phase 4.
- **Merging a stack:** merge one PR, **wait until GitHub shows the next PR's
  base as `main`**, then merge the next. Merging a child while its base is
  still the deleted parent branch lands it on that branch, not `main` (what
  happened to #115-#122).
- Each PR: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build:app`
  pass locally (the two known Windows `EPERM` failures in
  `core/db/__tests__/migration.test.ts` excepted) and in CI.
- Fixes are new commits, never amends. After fixing a lower PR, restack the
  ones above it.
- Never stage `docs/plans/` or `docs/.scratch/`. No `npm install` in a
  worktree whose `node_modules` is a junction.

```
main
 ├─ 1.1                                   Phase 1  tutorial
 ├─ 2.1 ─ 2.2                             Phase 2  sync icons
 └─ 3.1 ─ 3.2 ─ 3.3                       Phase 3  accounts core
main (after Phases 2 and 3 merge)
 └─ 4.1 ─ 4.2 ─ 4.3 ─ 4.4                 Phase 4  header, create repository, repository picker
                      └─ 5.1              Phase 5  accounts lesson + docs
```

## 6. Model and effort

| Level | Model | Use for |
|---|---|---|
| High | `anthropic/claude-opus-5-5#high` | Security boundary, credentials, CLI process handling, migrations, every review |
| Medium | `opencode/deepseek-v4.1-flash-free#high`; Opus high when DeepSeek is rate-limited | UI on existing components, tutorial content, docs |

Every PR is reviewed by an Opus high subagent before it is handed to the user.

## 7. Phases

### Phase 1: Tutorial chapter "Version history and sync" (Medium)

**1.1 `git-accounts/1.1-tutorial-version-history`**

- New chapter `version-history` after `organize`, before `agents`, with
  lessons (ids final once shipped):
  - `git-track`: track a workspace; auto vs manual commit; what never reaches
    the repository (secret values, `<SECRET>`).
  - `git-remote`: create an empty repository, connect, what Sync now and the
    5-minute sync do; the header states.
  - `git-open`: open a workspace from git on a second machine; setting the
    secrets the repository references.
  - `git-merge`: two machines edit, Merge needed, Review merge, pick per field
    or per record, Abandon merge.
  - `git-ci`: `apiweave run ./repo` in CI, `--project`/`--workflow`/`--bail`,
    secrets from environment variables, JUnit.
- New destination `version-history` → the Version history settings route.
- Update `app.ts` where it mentions the panel, if it should link the lesson.
- Content must match the shipped behaviour in
  `docs/guides/git-workflows.md`; no feature from Phases 3-4.
- Tests: `curriculum.test.ts` ids list; destination mapping.

### Phase 2: Sync icons (Medium)

**2.1 `git-accounts/2.1-sync-kind`**: the §4.1 vocabulary as one pure
function with tests; `GitSyncControl` and `GitSyncStatusCard` use it; the
Committed → Local history wording; **Commit now** hidden when nothing is
uncommitted. Update `gitSync.test.ts` and `GitSyncControl.test.tsx`.

**2.2 `git-accounts/2.2-switcher-sync-icons`**: a `statusAll()` bridge method
returning every tracked workspace's status (privileged bridge, zod-validated
like the rest), plus a hook that subscribes to the existing change event. Each
switcher row shows the sync icon with a tooltip naming the state. Untracked
rows unchanged.

### Phase 3: Accounts core (High)

**3.1 `git-accounts/3.1-host-cli`**: `HostCliService` with `detect`,
`listAccounts`, `token`; parsers tested against recorded real output from
both CLIs (redact tokens in fixtures); bridge method `accounts.list`. No UI
beyond what tests need.

**3.2 `git-accounts/3.2-workspace-account`**: migration `027`; repository
methods; per-call credential injection (§4.2) in fetch, push and clone;
`connectRemote` and `openFromGit` accept an optional account; Version history
shows an account picker next to the remote URL and on a connected workspace
(change account). Tests: the helper reset really overrides a URL-scoped helper;
token never in argv, errors or logs; a workspace with no account behaves as in
0.20.0.

**3.3 `git-accounts/3.3-sign-in`**: `signIn(provider, host)` per §4.2, with a
renderer dialog showing the code, **Open browser again**, **Cancel**, and the
result. Document the verified no-TTY behaviour of both CLIs in the PR.

### Phase 4: Header and repository creation (Medium UI, High core)

**4.1 `git-accounts/4.1-accounts-menu`** (Medium): header accounts menu and
Settings > Git accounts (§4.3).

**4.2 `git-accounts/4.2-create-repository`** (High): `createRepository` in
`HostCliService` for both providers (owners from `gh api user/orgs` and the
GitLab groups the account can create in), empty repository, HTTPS or SSH URL
per the account's protocol; **Create repository** in Version history; the
failure paths in §4.3.

**4.3 `git-accounts/4.3-repository-picker`** (High core, Medium UI):
`listRepositories(account, { topic, emptyOnly })` in `HostCliService` for both
providers; Account → Repository → "Use a URL instead" in Version history
(empty repositories, Create repository… first) and in
`OpenWorkspaceFromGitModal` (topic `apiweave-workspace`, Show all switch). 4.2
tags what it creates with the topic.

**4.4 `git-accounts/4.4-create-workspace-sync`** (Medium): the optional
section in `CreateWorkspaceModal`, reusing 4.3's pickers.

### Phase 5: Docs and lesson (Medium)

**5.1 `git-accounts/5.1-accounts-docs`**: tutorial lesson `git-accounts`
(connect an account, create a repository from Create workspace, several
accounts, GitLab's one-account-per-host limit); update
`docs/guides/git-workflows.md` and the README feature list; `CHANGELOG.md`
**Unreleased** section for everything in Phases 1-5.

## 8. Risks

- **`gh`/`glab` without a TTY** may prompt or wait for Enter. 3.3 verifies
  before building; the PTY host is the fallback.
- **`gh auth login` may edit the user's global git config** (credential
  helper). Accept it only if it is what `gh` does from a terminal too, and say
  so in the sign-in dialog.
- **Windows credential helper** via `sh`: covered by a test that runs on the
  Windows CI job.
- **Token leakage**: tokens only in a child's environment; redaction extended;
  tests assert absence from argv, errors and IPC payloads.
- **Repository created, connect failed**: never auto-delete; tell the user and
  offer the connect.
- **CLI missing or signed out**: the flows degrade to today's paste-a-URL path
  with an install link, never a dead end.

## 9. Out of scope

- Brand logos, avatars fetched from the network.
- Bitbucket, Gitea and other hosts' APIs.
- Reading every repository's content to find workspaces (the topic stands in).
- Storing tokens in APIWeave.
- Branch pickers (still one branch per workspace).
