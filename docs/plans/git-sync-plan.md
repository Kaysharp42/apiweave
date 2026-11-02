# Git sync: replacing APIWeave Cloud with the user's own git repo

Status: planned, 2026-10-18. Supersedes the Cloud sync architecture in
`apiweave-cloud/.omo/plan/PLAN.md` and the product boundary in
`FRONTEND-REDESIGN-PLAN.md` §4.

## 1. Goal

Remove the Cloud backend completely and sync workspaces through a git remote the
user owns, such as GitHub, GitLab, Bitbucket, Gitea or a bare repo on a drive.
The model is XPipe's git vault. `apiweave-cloud` shrinks to a static marketing,
docs and download site. Login, accounts, teams, devices, invitations and the
conflict center all go away. The git host is the identity and permission system.

Why this works: the Cloud existed to provide five things — identity, membership
and roles, a revision log, conflict storage, and a 3-way merge. Git plus the git
host already provides all of them. The five roles (read, triage, write, maintain,
admin) are GitHub's repository roles, word for word.

## 2. Decisions (made by the user, 2026-10-18)

| # | Decision |
|---|---|
| D1 | **One repo per workspace.** A workspace with no repo bound stays local-only. The repo is the access boundary, so different workspaces can belong to different teams or hosts. |
| D2 | **The git host enforces roles.** Push access means write; clone-only access means read-only. There is no roles code and no members file in the app. A refused push puts the workspace into read-only mode. |
| D3 | **Secret values never leave the machine.** The repo carries `{{secrets.NAME}}` references and secret names only, as exports do today. CI injects values from environment variables (`apiweave run` already supports this). |
| D4 | **System git CLI.** Git must be installed, as XPipe requires. We get Git Credential Manager (browser OAuth to GitHub, GitLab, Bitbucket and Azure), SSH keys and agents, and credential helpers without writing any auth code. |
| D5 | **The app manages the working copy** at `userData/git/<workspaceId>/`. Only the app writes there, so there is no file watcher. |
| D6 | **One tracked branch per workspace in v1** (configurable, default `main`). Branch switching and PR flows are a later layer. |
| D7 | **Auto and manual sync**, set per workspace. Auto is the default: commit and push after ~30 s idle, pull on startup and every 5 min. Manual shows pending changes, a Sync button and an optional commit message. |
| D8 | **APIWeave does the merge.** A semantic 3-way merge by node, edge and field, not git's line merge. The result is committed as a real two-parent merge commit. |
| D9 | **Hard cut.** There are no real Cloud users, so the `cloud_*` tables and all Cloud code are deleted with no sunset or migration path. Every desktop already holds a full local copy, so no data is lost. |
| D10 | **`apiweave-cloud` becomes a static export** (Next `output: "export"`) on GitHub Pages or Cloudflare Pages. The Go API, Postgres, Zitadel, Caddy and the server are retired. |
| D11 | **The one-shot "Export/Import project folder" is removed.** Its serializer becomes the core of the repo format. The single-file `.awecollection` export stays for sharing a copy. |

Defaults chosen by the plan, open to objection:
- Workspaces with E2EE enabled lose the setting. A private repo replaces it.
- Unbinding or deleting a workspace deletes only the local clone and never touches the remote.
- Local `workflow_revisions` history stays as it is. Replacing it with git history is a later, separate change.

## 3. Target architecture

### 3.1 Data flow

The local SQLite database stays the source of truth. The clone is a
deterministic projection of it.

```
            ┌──────────── serialize (deterministic) ───────────┐
SQLite ─────┤                                                  ├──► working tree ──► git commit ──► push
(truth)     └──◄── import (upsert by id, delete missing) ◄─────┘         ▲
                                                                         │
                                       fetch ──► fast-forward or semantic merge
```

A sync cycle, per workspace, serialized behind a per-workspace lock:

1. **Serialize** the workspace into the clone. Write only files whose bytes
   changed, and remove files the format owns that no longer map to a record.
2. **Commit** if `git status --porcelain` is non-empty. The author comes from the
   user's git config; if that is missing, ask once and set it repo-locally.
3. **Fetch** the tracked branch.
4. **Integrate**, depending on where local and remote stand:
   - Remote has nothing new: skip to push.
   - Remote ahead, local has nothing to push: fast-forward, then import.
   - Diverged: run the semantic merge (§3.4). A clean result is committed as a
     merge commit and imported. Conflicts stop the cycle and wait for the user.
5. **Push.** A rejection is classified: a non-fast-forward means the remote moved
   during the cycle, so retry once from step 3. A permission or protected-branch
   refusal puts the workspace in read-only mode (§3.5). Network and auth errors
   are surfaced and retried on the next tick.

What triggers a cycle:
- In **auto** mode: any committed write to the workspace (debounced 30 s), app
  start, every 5 min, and Sync now.
- In **manual** mode: Sync now only. The app still runs a fetch on start and on
  the interval so it can show "N incoming changes"; integrating them happens on
  Sync.

The write signal reuses what exists. `WorkflowRepository` already has an
`onChanged` observer, and Collection, Environment and Workspace repositories
already defer observers until commit (`transactionNotifications.ts`). Add the
same observer to those three repositories rather than inventing an event bus.
Imports suppress the trigger, because importing a tree and re-serializing it
produces no diff anyway.

### 3.2 Repo format

```
.apiweave/format.json              {"format": "apiweave-workspace", "version": 1}
.gitattributes                     * text eol=lf
workspace.json                     id, name, settings
projects/<slug>--<id>.json         name, description, color, workflow order (workflowId, enabled, continueOnFail)
workflows/<slug>--<id>.json        one file per workflow, including workflows in no project
environments/<slug>--<id>.json     workspace-scoped environments: variables and secret names
```

Rules (most of them inherited from `core/services/project_folder.ts`):
- Sorted keys, with top-level fields in a fixed order.
- Nodes sorted by id, with a group frame before its children. Edges sorted by id.
- Positions rounded to whole pixels.
- 2-space indent, LF line endings, trailing newline.
- Nothing volatile: no `rev`, timestamps, run state or local paths.
- **The id is part of every file name** (`<slug>--<ulid>.json`), so two people
  creating "Get user" at the same time never collide on a path. The slug is
  cosmetic; renaming a workflow renames its file, and git's rename detection
  plus the id inside the file keep that a clean change.
- **The folders are flat.** Moving a workflow between projects edits two JSON
  fields instead of moving a file.
- **Never written to the repo:** user-scoped environments, secret values and
  ciphertext, runs, node presets, agents, agent local paths, workflow
  revisions, and environment `baseEnvironmentId` (it isn't synced today).
- **Literal credentials** typed into nodes are redacted exactly as export does.
  On import, a redacted field never overwrites the local value; this reuses
  `upsertProject`'s withheld-credential logic. See the `<SECRET>` re-import
  memory: that bug must not come back through this path.
- Before any file is written, `assertNoSecretValues` runs over the whole tree.

### 3.3 Git invocation

`core/git/git_service.ts` calls `execFile("git", args)`. There is no shell and no
wrapper library: the commands needed are about a dozen, and `simple-git` would
add a dependency without removing any real code. Every call gets:

```
git -c core.hooksPath=<empty dir in userData> -c core.autocrlf=false -c core.fsmonitor=false \
    -c protocol.ext.allow=never -c credential.interactive=auto <command> ... -- <paths>
env: GIT_TERMINAL_PROMPT=0, GIT_OPTIONAL_LOCKS=0, LC_ALL=C
```

- **Hooks are off.** A global husky or pre-commit setup must not run inside the app's clone.
- **`protocol.ext.allow=never`.** The `ext::` transport executes commands.
- **`--` comes before every positional argument**, and remote URLs that start
  with `-` are rejected, which closes off argument injection.
- **Timeouts** per command, with a longer one for network operations.
- **`LC_ALL=C` keeps stderr stable**, so error classification can match it:
  `GitNotInstalled`, `AuthFailed`, `NonFastForward`, `PermissionDenied`
  (403, "protected branch", "permission to … denied", "pre-receive hook
  declined"), `NetworkError`, `NotARepository`.

The service stays Electron-free so it can run under vitest against real
temporary repositories.

### 3.4 Semantic merge

The merge is a port of `apiweave-cloud/apps/api/internal/sync/merge.go` (338 LOC)
into `shared/git-merge/`, together with `shared/conflict-diff/`, which Phase 0
deletes and Phase 3 restores from git history.

- Inputs per path: the merge base (`git merge-base`), ours and theirs, read
  with `git show <rev>:<path>` and parsed through the format's zod schemas.
- **Files:**
  - Added on one side: take it.
  - Deleted on one side and untouched on the other: delete.
  - Deleted on one side and modified on the other: record-level conflict.
  - Add/add on the same path can't happen, because ids are unique.
- **Inside a record:**
  - Arrays of identified items are merged as maps keyed by id: nodes by
    `nodeId`, edges by `edgeId`, project workflow order by `workflowId`.
    Variables merge by key.
  - Objects merge per key.
  - Scalars: if both sides agree, keep it. If one side changed, take that
    side. If both changed it differently, it's a conflict at that path, for
    example `nodes.n1.config.method`.
- **Conflicts that resolve automatically:**
  - Positions, which take theirs.
  - Project workflow-order position, which is a union ordered by theirs, then
    our new items.
- **Dangling edges** (an edge whose source or target node was deleted on the
  other side) are dropped, and the merge reports it.
- **Committing a merge** uses `git merge --no-ff --no-commit -s ours <remote>`,
  then overwrites the tree with the merged files, `git add -A` and
  `git commit`. Git keeps `MERGE_HEAD`, so the result has two parents and
  `git merge --abort` is the cancel.
- **The merge is deterministic.** After a restart the conflict set is recomputed
  from base, ours and theirs, so only the user's picks are persisted, keyed by
  `(recordId, path)`.
- While a merge is pending, auto-commit pauses and local edits keep working.
  At finalize time, if the database changed since the merge began, the merge is
  aborted, the local edits are committed, and the merge is redone with the
  saved picks. That way an import can never overwrite an edit made during
  resolution.

### 3.5 Roles and read-only

The app has no notion of roles. A push refused with `PermissionDenied` marks the
binding `readOnly`. In read-only mode:
- Edits still save locally and are committed locally.
- A banner says the user can't push to this repo and their changes stay on this
  device. It offers **Discard local changes**, which resets to the remote and
  re-imports, and **Retry**.
- Pulls continue as normal.

Maintainer and admin powers (branch protection, CODEOWNERS, who can push) are
configured on the host.

### 3.6 Security boundary

- **Every git operation goes through a privileged preload world,
  `__APIWEAVE_GIT__`,** registered with `ipcMain.handle` behind
  `requireTrustedSender`. **None of it goes on the IPC router, so none of it is
  reachable through the MCP bridge.** An agent that could set a remote URL could
  push the workspace to a repo it controls. This follows the same rule as
  updates and agent spawning in `AGENTS.md`.
- **A clone's content is untrusted input.** Every file is zod-validated before
  import. Ids are checked with the `folderId` regex, paths stay inside the
  clone, and files have size limits. A repo whose `format.json` reports a newer
  version is refused with an "update APIWeave" message.
- **Repo-controlled config can't run code.** Git config isn't cloned, and
  hooks, fsmonitor and `ext::` are disabled per call.

### 3.7 Persistence

The `workspace_git` table, migration `024`:

| column | meaning |
|---|---|
| `workspace_id` PK FK → workspaces ON DELETE CASCADE | |
| `remote_url` nullable | null means local history only |
| `branch` | tracked branch, default `main` |
| `mode` | `auto` or `manual` |
| `read_only` | set when a push is refused for permissions |
| `state` | `idle`, `syncing`, `merging` or `error` |
| `last_error` | classified error code and message |
| `last_synced_commit` | remote commit last integrated |
| `last_synced_at` | |

The `merge_picks` table, migration `025`: `workspace_id, record_id, path, side (ours|theirs)`.

## 4. Stacked PR workflow

Every phase is a stack of small PRs. Each PR is reviewable on its own and keeps
every check green.

### Conventions

- **Branch names:** `git-sync/<phase>.<n>-<slug>`, for example
  `git-sync/0.2-remove-cloud-main`.
- **Bases:** the first PR of a phase targets `main`, or the last PR of the
  previous phase if that hasn't merged yet. Every later PR targets the branch
  directly below it.
- **Creating a PR:**
  `gh pr create --base git-sync/0.1-remove-cloud-renderer --head git-sync/0.2-remove-cloud-main`.
  Put the stack map at the top of each PR description:
  ```
  Stack: #110 0.1 ← #111 0.2 (this) ← #112 0.3
  ```
- **CI runs on every PR whatever its base.** `quality.yml` triggers on
  `pull_request: branches: ["**"]`. Each PR must pass `npm test`, `typecheck`,
  `lint`, `build:app` and fallow on its own. No "fixed in the next PR".
- **Updating a lower PR:** commit on its branch, then from the top branch run
  `git rebase --update-refs <lowest changed branch>` and
  `git push --force-with-lease` for each branch that moved.
- **Merging, desktop repo (`apiweave`):** merge commits (the repo convention),
  bottom-up. Turn on "Automatically delete head branches", and GitHub retargets
  the next PR to `main` once its base merges. No restack is needed after a merge
  commit.
- **Merging, `apiweave-cloud`:** squash merges. After a parent is squashed, each
  child needs `git rebase --onto main <old parent tip> <child>`. Phase 4's stack
  is kept short for that reason.
- **Releases:**
  - Phase 0 alone can ship.
  - Phase 1 alone can ship, as local history.
  - **Don't cut a release tag while Phase 2 is merged without Phase 3**, because
    2.3 deliberately blocks diverged histories.
- **Fallow:** only introduced findings fail the check. Deleting consumers can
  orphan exports; delete the orphan in the same PR instead of baselining it.
  When local fallow output disagrees with CI, see the `apiweave-fallow-gate`
  memory.

### Stack map

```
main
 └─ 0.1 ─ 0.2 ─ 0.3 ─ 0.4 ─ 0.5                  Phase 0  remove Cloud from the desktop
     └─ 1.1 ─ 1.2 ─ 1.3 ─ 1.4 ─ 1.5               Phase 1  repo format + local history
         └─ 2.1 ─ 2.2 ─ 2.3 ─ 2.4                  Phase 2  remotes
             └─ 3.1 ─ 3.2 ─ 3.3                    Phase 3  semantic merge
apiweave-cloud main
 └─ 4.1 ─ 4.2 ─ 4.3                                Phase 4  static site
```

Phase 4 is independent of Phases 1 to 3 and can run in parallel at any time
after 0.2. 1.1 and 1.3 have no dependency on each other and can be built in
parallel, then stacked in order.

## 5. Model and effort guide

| Level | Model, effort | Use for |
|---|---|---|
| **High** | Opus 5.5, `high`; `max` where noted | Contracts every later byte depends on, data-loss paths, state machines, security boundaries |
| **Medium** | Sonnet 5.5, `medium` or `high` | Wide but well-guided changes: deletions steered by the typechecker, UI built on existing components, CI rewiring |
| **Low** | Haiku 5.5, `low` or `medium` | Docs sweeps, renames and mechanical cleanups with an exact file list |

Every PR is reviewed with `/code-review` before it's marked ready. High PRs get
`/code-review high`, and renderer PRs also get `/react-doctor`.

## 6. Phases

Sizes are rough: `+` is lines added and `−` lines removed, tests included.

---

### Phase 0: Remove Cloud from the desktop

Outcome: the app has no sync, no account and no roles code, and every check
passes. Roughly 13k lines of product code and 6.6k lines of tests go.

#### PR 0.1 `git-sync/0.1-remove-cloud-renderer`: Medium (Sonnet 5.5, medium)
Delete the renderer's Cloud UI.
- `src/pages/cloud/`: `CloudSyncPage`, `ConflictsPage`, `ConflictDetailPage`,
  `FailedRecordsDialog`, `WorkspaceEncryptionDialog`.
- `src/components/cloud/ConflictList.tsx`.
- In `src/components/layout/`: `CloudAccountSection`, `CloudAttentionBanner`,
  `SyncAlerts`, and the Cloud parts of `AccountMenu`/`accountMenuUtils`.
  `AccountMenu` goes entirely if nothing local is left in it.
- `src/hooks/useCloudSync.ts`, `useAccountSessionReset.ts`, `src/utils/cloudAttention.ts`.
- In `src/types/`: every `Cloud*`, `Conflict*` and `ResolveConflictRequest`
  type, `UseCloudSync`, `cloud.ts`, and their `index.ts` exports.
- The `/cloud/*` routes in `App.tsx`. The team and encryption options in
  `CreateWorkspaceModal` and `OrgWorkspaceSwitcher`. `PassphraseFields` if
  only encryption used it.
- Tutorial steps that mention Cloud (`src/constants/tutorials/*`, `tutorialScope.ts`).
- `shared/conflict-diff/`, if nothing else imports it. Phase 3 restores it from
  this PR's parent commit.
- The bridge methods the renderer called stay in preload until 0.2, which keeps
  this PR renderer-only.

Acceptance: no `cloud` route or menu entry is left, the workspace switcher still
works, and every check is green.
Size: about −4.5k. Watch out: `MainLayout` single-mount invariants (memory). Don't
reintroduce a responsive double mount while removing banners.

#### PR 0.2 `git-sync/0.2-remove-cloud-main`: Medium (Sonnet 5.5, high)
Delete the main-process and core Cloud code.
- `electron/cloud/`, all of it including `__tests__/`, plus the Cloud wiring in
  `electron/main.ts` (about lines 471–657) and the Cloud preload surface.
- `core/sync/` (`SyncProvider`, `SwitchableSyncProvider`,
  `LocalOnlySyncProvider`, `cloud-mutations`).
- `core/repositories/CloudSyncRepository.ts`, `core/services/cloud_sync_control.ts`,
  `cloud_first_sync_service.ts`.
- `core/ipc/handlers/cloud.ts` and its registration, plus
  `CLOUD_STATUS_CHANGED_CHANNEL`.
- Every `syncProvider` constructor argument and all 88 `record*`/`push()` call
  sites across `workflow_service`, `collection_service`,
  `environment_service`, `workspace_service`, `import_service`,
  `project_export_service`, `node_preset_service`, `run_service`,
  `secret_service`, `services-locator.ts` and `core/cli/cli.ts`. These are
  pure deletions with no replacement; Phase 1 adds the new trigger.
- The `@apiweave/proto` devDependency in `app/package.json`, and the
  `allow-remote=root` block in `app/.npmrc` (the proto tarball was its only
  reason). Regenerate `package-lock.json`.
- `electron/key_protector.ts` stays, because the secrets keyfile uses it.

Acceptance: `grep -ri "apiweave/proto\|cloud" app/core app/electron` finds only
unrelated hits. The app starts, edits and runs. The CLI still runs exported files.
Size: about −9k (including tests). Watch out: run `npm test`, not bare vitest
(sqlite ABI memory). The Windows `login_path` failure and the flaky MCP SSE test
are known and not caused by this PR.

#### PR 0.3 `git-sync/0.3-drop-cloud-schema`: High (Opus 5.5, high)
Migration `023_drop_cloud.sql`:
- Drop `cloud_devices`, `cloud_workspace_bindings`, `cloud_record_state`,
  `cloud_outbox`, `cloud_workspace_tombstones`, `cloud_conflicts` and
  `cloud_workspace_accounts`.
- Drop `workspaces.origin` and `workspaces.syncMode`. SQLite's `DROP COLUMN`
  refuses columns used in CHECK constraints, indexes or triggers. If either is,
  rebuild `workspaces` (create the new table, copy, drop, rename) with
  `foreign_keys` off for the rebuild and `PRAGMA foreign_key_check` before
  commit. `workflows`, `collections`, `environments` and others cascade from it.
  The rebuild must not fire `ON DELETE CASCADE`, and must preserve the `*_touch`
  triggers.
- Delete the `cloud.*` keys from `app_settings`, and the `safeStorage` WDEK
  entries (`cloud.e2ee.wdek.*`) wherever they're stored.
- Drop `scoped_keys` (001), which no code references.

Also remove `origin` and `syncMode` from the `Workspace` types, zod schemas,
repository mappers and the renderer `Workspace` type. Remove `isPersonal`
special-casing that existed only for Cloud provisioning; the personal workspace
itself stays.

Acceptance: a migration test runs from a fixture database carrying real Cloud
rows, then checks foreign-key integrity, row counts for every content table, and
that triggers still bump `rev`.
Size: about +250 / −300. Watch out: `apiweave-line-endings` memory. Keep new SQL
files LF.

#### PR 0.4 `git-sync/0.4-remove-roles`: Medium (Sonnet 5.5, medium)
- Delete `core/auth/` (`permissions.ts`, `PermissionProvider`,
  `LocalOwnerProvider`, `index.ts`) and `core/services/authorize.ts`.
- Remove the 34 `authorize(...)` calls in the 4 services that make them, plus
  the provider wiring in `electron/main.ts`, `core/cli/cli.ts` and
  `core/services-locator.ts`.
- In the renderer, delete the fake-admin `AuthProvider`, and the hard-coded
  role `"owner"` in `WorkspaceContext.tsx`, with anything that branches on it.

Acceptance: no `Permission`/`role` symbols are left outside agent-related code,
and every check is green.
Size: about −800.

#### PR 0.5 `git-sync/0.5-docs-cloud-removal`: Low (Haiku 5.5, medium)
Remove Cloud wording from the docs that mention it:
- `docs/features/`: `environments-and-secrets`, `mcp-integration`,
  `node-presets`, `tutorials`, `workflows-and-nodes`.
- `docs/getting-started/`: `concepts`, `installation`.
- `docs/README.md`.
- `docs/reference/`: `api`, `architecture`, `environment-variables`,
  `placeholders`, `release-and-updates`.
- `README.md`, `PRODUCT.md`, `apiweave-context.md`,
  `.github/copilot-instructions.md`.

Add a one-line "Git sync is coming" note only where a doc previously promised
sync. Update `AGENTS.md` only where it names Cloud.
Size: about −400. Review: Sonnet `/code-review medium` for accidental claims.

---

### Phase 1: Repo format and local history

Outcome: a workspace can be tracked by a local git repo. Every change becomes a
commit (auto or manual) and the history is browsable with any git tool.
`apiweave run` reads the repo.

#### PR 1.1 `git-sync/1.1-workspace-repo-format`: High (Opus 5.5, high)
This PR defines the contract every later byte depends on.
- `core/services/workspace_repo_format.ts`, grown out of `project_folder.ts`
  (move it; don't keep both):
  - `serializeWorkspace(snapshot): Map<path, text>`
  - `parseWorkspace(files: Map<path, text>): WorkspaceSnapshot`, which
    zod-validates each file and the manifest.
  - Pure functions with no filesystem access.
- Implements everything in §3.2: id-suffixed names, flat folders, `format.json`,
  `.gitattributes`, redaction, `assertNoSecretValues`.
- `WorkspaceSnapshot` is built from the repositories, read-only.

Tests:
- A round trip from a seeded database through files and back yields an
  identical snapshot.
- Golden-file fixtures, so any format change shows up as a reviewable diff.
- Determinism: shuffled input order gives byte-identical output.
- Two workflows with the same name give distinct paths.
- Path-traversal and oversized-file rejection.

Size: about +900 / −350.

#### PR 1.2 `git-sync/1.2-workspace-repo-import`: High (Opus 5.5, high)
- `WorkspaceRepoImporter.apply(workspaceId, snapshot)`, all in one transaction:
  - Upsert workspace settings, projects, workflows and environments by id.
  - **Delete** records whose file is gone.
  - Keep withheld credentials.
  - Record `workflow_revisions` entries with source `git`.
  - Emit repository change notifications so open canvases refresh through the
    existing live-update path (`useWorkflowLiveUpdates`).
- Generalize the matching logic in `ProjectExportService.upsertProject`;
  don't duplicate it.

Tests:
- Import onto a database with extra records deletes exactly those.
- A redacted credential never overwrites a local literal (regression test for
  the `<SECRET>` re-import memory).
- A failed import rolls back completely and sends no notifications.

Size: about +600 / −200.

#### PR 1.3 `git-sync/1.3-git-service`: Medium (Sonnet 5.5, high)
- `core/git/git_service.ts`, as described in §3.3: `version`, `init`, `status`,
  `add`, `commit`, `revParse`, `mergeBase`, `show`, `fetch`, `push`, `clone`,
  `remote add/set-url`, `merge --abort`, `reset --hard`, `log`.
  Each returns typed results; failures throw classified errors.
- Detects a missing git binary with an install link per OS. On macOS, the
  Xcode command-line-tools stub counts as installed once it works.
- Electron-free.

Tests: real git against temporary directories, plus a bare `file://` remote.
Includes stderr classification fixtures for GitHub, GitLab and Gitea refusal
messages, and a check that hooks don't run (a global hook dir that writes a
marker file).
Size: about +700.

#### PR 1.4 `git-sync/1.4-local-history`: High (Opus 5.5, high)
- Migration `024_workspace_git.sql`, as in §3.7.
- `core/git/git_sync_service.ts`:
  - per-workspace lock;
  - `track(workspaceId)`: `git init` in `userData/git/<id>`, write the format,
    make the first commit;
  - `untrack`: delete the clone and the row;
  - `commitLocal(message?)`;
  - auto-mode debounce on repository change notifications. Add `onChanged` to
    the Collection, Environment and Workspace repositories, following the
    `WorkflowRepository` pattern.
- Startup: for each tracked workspace, make sure the clone exists; recreate it
  from the database if the folder was deleted.
- Privileged preload world `__APIWEAVE_GIT__` with `requireTrustedSender`,
  covering `status`, `track`, `untrack`, `setMode`, `syncNow` and a status
  change channel.
- Minimal UI: a "Version history (git)" section in workspace settings with
  track/untrack, the auto/manual switch, the last commit, and Commit now with a
  message in manual mode. Use the existing `Panel`, `FormField` and `Button`
  components.

Tests: service-level tests with fake timers for the debounce. Edit, then 30 s
later exactly one commit. Edits during an import produce no commit. Commits are
serialized per workspace.
Size: about +1.1k.

#### PR 1.5 `git-sync/1.5-remove-project-folder-export`: Medium (Sonnet 5.5, medium)
- Delete the `projectFolder:export/import` channels, the
  `__APIWEAVE_PROJECT_FOLDERS__` preload world, its `main.ts` handlers and the
  folder UI in `CollectionExportImport.tsx`.
- CLI: `apiweave run <path>`, where the path is a workspace repo (detected by
  `.apiweave/format.json`), with `--project <name|id>` to pick one project; the
  default runs all of them. Exit codes are unchanged (0/1/2). The esbuild
  no-Electron guard must stay green.
- Rewrite `docs/guides/git-workflows.md` and `docs/guides/ci.md` around
  workspace repos.

Size: about +300 / −700.

---

### Phase 2: Remotes

Outcome: a workspace syncs with a remote, a second device or teammate can open
it from git, and refused pushes become read-only mode. Diverged histories are
detected and blocked until Phase 3.

#### PR 2.1 `git-sync/2.1-connect-remote`: Medium (Sonnet 5.5, high)
- "Connect to remote" on a tracked workspace:
  - URL validation: `https://`, `ssh://`, scp-like `user@host:path`, `file://`.
    Reject anything starting with `-`, and `ext::`.
  - `git remote add origin -- <url>`, then fetch.
  - Remote empty: `push -u`.
  - Remote has unrelated history: refuse, and point to "Open workspace from git".
- Disconnect removes the remote and keeps local history.

Tests: against a bare `file://` remote, covering empty, non-empty-unrelated and
unreachable remotes.
Size: about +450.

#### PR 2.2 `git-sync/2.2-open-from-git`: Medium (Sonnet 5.5, high)
- "Open workspace from git": clone into a temporary directory, validate
  `format.json` and parse the whole tree, then create the workspace using the
  id from `workspace.json`. Refuse if that id already exists locally, with a
  link to the existing workspace. Move the clone to `userData/git/<id>`, import,
  and track in auto mode.
- Entry points: the workspace switcher and the empty state.

Tests: a clone of a repo pushed in 2.1 yields an identical snapshot. Covers the
duplicate-id refusal, the newer-format refusal and invalid files.
Size: about +500.

#### PR 2.3 `git-sync/2.3-sync-cycle`: High (Opus 5.5, high)
- The full cycle from §3.1, steps 1–5: fetch, fast-forward with import, push,
  one retry on non-fast-forward, and read-only on `PermissionDenied` (§3.5).
  **Diverged sets the state to `diverged` and stops**; Phase 3 replaces that.
- A 5-minute interval timer in main, pulling on start. Manual mode fetches only
  and reports incoming counts.
- "Discard local changes": `reset --hard @{u}` and re-import.

Tests: a two-clone harness (devices A and B against one bare remote). Covers A
edits and B auto-pulls, B being read-only (a pre-receive hook rejecting B),
network loss mid-push, and the app restarting mid-cycle (the state recovers).
Size: about +900.

#### PR 2.4 `git-sync/2.4-sync-ui`: Medium (Sonnet 5.5, high)
- A sync status control in the layout header, with the states synced, pending
  (N changes), syncing, incoming (manual), diverged, read-only and error.
  Status is never shown by color alone.
- Sync now.
- In manual mode, a dialog listing pending changes, mapping file paths to
  record names (added, changed, deleted workflow "X"), with a message field.
- Workspace settings: remote URL, branch, mode and disconnect.
- Error messages say what happened and what to do next, for example: "Git
  isn't installed", "Sign-in to github.com failed — your credential manager
  will ask again on retry", "You can't push to this repo".

Acceptance: renderer e2e harness (fake IPC bridge, see memory) screenshots of
each state, and `/react-doctor` clean.
Size: about +900.

**Release gate: don't tag until Phase 3 is merged.**

---

### Phase 3: Semantic merge

Outcome: concurrent edits merge automatically when they don't overlap. Real
clashes go to a per-field picker. The result is a two-parent merge commit.

#### PR 3.1 `git-sync/3.1-semantic-merge-core`: High (Opus 5.5, **max**)
- Restore `shared/conflict-diff/` from history (`git show <0.1 parent>:app/shared/conflict-diff/...`).
- `shared/git-merge/`: `mergeRecord(kind, base, ours, theirs) → {merged, conflicts[], notes[]}`
  and `mergeTree(baseFiles, ourFiles, theirFiles) → {files, conflicts, notes}`,
  following the rules in §3.4 and porting `merge.go` behaviour.
- Pure, with no git and no I/O.

Tests:
- Table tests for every rule in §3.4.
- Property tests:
  - `merge(b, x, b) = x`
  - `merge(b, b, y) = y`
  - `merge(b, x, x) = x`
  - conflict paths are symmetric when the sides are swapped
  - merging never invents ids
- Fixtures taken from real workflows, including the 130-node probe workflow
  from the run-camera memory.

Size: about +1.3k.

#### PR 3.2 `git-sync/3.2-merge-cycle`: High (Opus 5.5, high)
- Replace `diverged` with the merge path from §3.4: merge-base, read the three
  trees, `mergeTree`.
- Clean result: `merge -s ours --no-commit`, overwrite the tree, commit, import,
  push.
- Conflicts: state `merging`; auto-commit pauses.
- Migration `025_merge_picks.sql`.
- `resolve(picks)`: if the database changed since the merge started, abort,
  commit locally and redo the merge, reapplying the picks. Then finalize, import
  and push. `abandon()`: `merge --abort`.
- The commit message lists auto-resolved notes (positions, dropped dangling edges).

Tests: two-clone harness scenarios.
- Disjoint node edits merge cleanly.
- The same field edited on both sides conflicts; the pick is applied and pushed,
  and the other device fast-forwards.
- Delete versus modify.
- An edit during resolution is preserved.
- The app restarts mid-merge and the picks survive.

Size: about +900.

#### PR 3.3 `git-sync/3.3-conflict-ui`: Medium (Sonnet 5.5, high)
- A merge page per workspace. It lists conflicted records and then, per record,
  a field diff with **Keep mine / Keep theirs** per path and for the whole
  record. Shows the author and commit for each side from `git log -1 <rev> -- <path>`.
- Reuses the per-field picker pattern from the deleted `ConflictDetailPage`
  (restore what fits from history rather than rewriting it).
- Abandon merge, with confirmation that local changes are kept.
- Vocabulary: "Your copy" / "Remote copy".

Acceptance: renderer e2e harness flows and `/react-doctor` clean.
Size: about +1k.

**After 3.3 merges, Phases 1–3 can be released together.**

---

### Phase 4: `apiweave-cloud` becomes a static site

Repo: `apiweave-cloud`. It squash-merges, so restack children with
`rebase --onto` (§4).

#### PR 4.1 `git-sync/4.1-web-static-export`: Medium (Sonnet 5.5, high)
- Delete `app/app/**` (the dashboard), `login`, `signup`, `invite/[token]`,
  `app/api/**` (auth, desktop config), and in `lib/`: `cloud-server`,
  `control-plane*`, `auth-*`, `oidc-backchannel`, `connect`, `e2ee`.
  Remove `@apiweave/proto` and `@connectrpc/*`.
- `PublicHeader` no longer reads the session.
- Robots policy, `WEB_PUBLIC_URL`, `llms.txt` and sitemap become build-time
  values. Remove `force-dynamic` and `headers()`.
- `/download` fetches the release version at build time; a client-side refresh
  is optional and can wait.
- `output: "export"`. Security headers move to `public/_headers` (Cloudflare
  Pages) or are documented for the host.
- Update the CI SEO job: it currently asserts that metadata is *not*
  prerendered, and that assertion flips.

Acceptance: `bun run build` emits `out/`. Landing, download, docs, guides and
compare render. Lighthouse and the a11y checks from Phase 11 still pass.
Size: about −8k.

#### PR 4.2 `git-sync/4.2-content-git-sync`: Medium (Sonnet 5.5, medium)
- Rewrite the landing page's Cloud section, FAQ and how-it-works, the docs and
  the guides around "Sync through your own git repo".
- Update the content rules (redesign plan §17 and `apps/web/DESIGN.md`). The
  rules that remain: no claims about cloud execution, no claim that secrets
  sync, no "production-ready".
- Add a short page on connecting a workspace to GitHub or GitLab.

Size: about ±600.

#### PR 4.3 `git-sync/4.3-delete-backend`: Medium (Sonnet 5.5, medium)
- Delete:
  - `apps/api/`, `proto/`, `packages/proto/`;
  - `deploy/` (compose, Caddy, Zitadel, systemd);
  - the Zitadel, deploy and backup scripts in `scripts/`;
  - the `/app` and auth suites in `e2e/`.
- CI: drop `test-go`, buf, `container-build`/`container-scan`, the desktop
  checkout job, `release.yml` and `backup-restore-drift.yml`. Add a Pages
  deploy workflow.
- Update `turbo.json`, `CONTRIBUTING.md` (scopes `sync`, `auth`, `api` and
  `deploy` go), `README.md` and `.omo/plan/` status notes.

Size: about −50k.

#### Workspace housekeeping (not a PR, since it's outside the repos)
Update `F:\Work\Visual API Test Story Builder\AGENTS.md`:
- §1: topology is now two repos plus the archived proto repo.
- §2: delete the proto contract flow.
- §4: content rules.
- §5: delete the backend rules.
- §6 and §7: CI gates.

#### User actions (Claude must not do these)
- Archive `Kaysharp42/apiweave-proto` on GitHub.
- Back up Postgres, then stop and remove the production and dev stacks on the
  server: api, web, Zitadel, Postgres, edge. Remove the systemd backup timers.
- Point `apiweave.app` DNS at Pages. Remove `api.`, `auth.`, `dev.`, `api-dev.`
  and `auth-dev.` and the Cloudflare Tunnel.
- Delete the Zitadel OAuth apps, GHCR images, cosign keys and the repo secrets
  (`BFF_SERVICE_TOKEN`, SSH deploy keys, and the rest).

---

## 7. Test strategy

| Layer | What | Where |
|---|---|---|
| Unit | Format round-trip and goldens, merge rules and properties, error classification | vitest, pure |
| Integration | Real git: one bare `file://` remote plus two clones as "device A/B" driven through `GitSyncService` | vitest, temporary directories; git is present on CI runners |
| Renderer | Sync status states, manual commit dialog, merge page | Playwright renderer harness with a fake IPC bridge |
| Real app | Two Electron instances with separate userData against one bare remote, an edit on A showing up on B, then a conflict resolved on B | Playwright `_electron` (see the `apiweave-electron-e2e-driving` memory); manual before release, not in CI |

Each PR runs `npm test`, `npm run typecheck`, `npm run lint` and
`npm run build:app` from `app/`, plus `graphify update .` after code changes.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Git not installed (mainly macOS without CLT, minimal Linux) | Clear detection and install link; local-only workspaces keep working without git |
| Credential prompts hang the cycle | `GIT_TERMINAL_PROMPT=0` plus timeouts; GCM's GUI still works; auth failures surface as a retryable state |
| Serializer and importer drift (a field written but not read) | Round-trip and golden tests in 1.1/1.2 are the gate; zod `.strict()` on every file |
| Data loss when importing deletes | One transaction, deletes limited to the format's record kinds, and an import never runs while local changes are uncommitted |
| Merge produces an invalid workflow | Merged records are re-validated with the zod schemas before commit; an invalid record becomes a record-level conflict |
| Agents abusing git through MCP | Privileged bridge only (§3.6), with a test asserting no `git` handler is on the router |
| CRLF churn on Windows | `core.autocrlf=false` per call, `.gitattributes eol=lf`, and the serializer always writes LF |
| Large workspaces make every cycle slow | Write only changed files; `git status` is cheap; measure in 1.4 with a 500-workflow fixture before optimizing |

## 9. Explicitly out of scope for v1

- Branch switching, creating branches, opening PRs from the app (D6).
- Encrypted secret values in the repo (D3).
- Host APIs (GitHub or GitLab REST) for permissions, PRs or avatars. Plain git only.
- A user-visible or user-chosen clone folder, and file watching (D5).
- Syncing node presets or user-scoped environments.
- Replacing local `workflow_revisions` with git history.
