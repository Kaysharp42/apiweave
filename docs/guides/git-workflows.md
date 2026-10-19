# Keep Tests in a Git Repository

*How a workspace is written as a git repository: the layout of its files, why they diff and merge well, what never reaches them, and how to run one in CI. For teams that want their API tests next to the code they test.*

> **In this release.** APIWeave tracks a workspace in a local git repository and commits to it: **Settings → Workspace settings → Version history (git)** has **Track this workspace**, a **Commit automatically** switch, **Commit now** (with an optional message), **Connect to remote** and **Stop tracking**. That repository lives on your machine, in the app's data folder. Connecting a remote pushes the history **once**, to an empty repository; after that the app never pushes or pulls again. The workspace switcher's **Open from git…** goes the other way, once: it clones a repository and opens the workspace in it as a new one, and nothing is read from the repository after that. `apiweave run` runs a repository's files in CI, so a checkout of one is all a pipeline needs.

## Prerequisites

- Git installed on the machine. APIWeave runs your own `git`, so its credential helpers and your configured author apply.
- Secrets referenced as `{{secrets.NAME}}`, not typed into requests. A repository never holds secret values; see [Secrets](#secrets).

## How it works

APIWeave keeps everything in its local database, and the database stays the source of truth. A tracked workspace is also written as a tree of JSON files, a projection of the database that is the same on every machine, and each change to the workspace becomes a commit of that tree. In **auto** mode (the default) a commit is made about 30 seconds after your last edit; in **manual** mode only **Commit now** commits. Nothing is committed when the tree has not changed.

A repository is also a format other tools can read: `apiweave run` takes a folder with this layout directly, with no database at all. See [Run a repository in CI](#run-a-repository-in-ci).

## Repository layout

```text
.apiweave/format.json              {"format": "apiweave-workspace", "version": 1}
.gitattributes                     * text eol=lf
workspace.json                     workspace id, name, description
projects/<slug>--<id>.json         name, description, color, workflow order (workflowId, enabled, continueOnFail)
workflows/<slug>--<id>.json        one file per workflow, including workflows in no project
environments/<slug>--<id>.json     workspace-scoped environments: name, description, swaggerDocUrl, isDefault, variables
```

- A folder holding `.apiweave/format.json` is a workspace repository; `apiweave run` detects one that way.
- **The folders are flat.** Moving a workflow between projects edits two JSON fields (the workflow's `projectId` and the projects' `workflowOrder`) and moves no file.
- A file is named `<slug>--<id>.json`. The slug is the name in lowercase (`Orders / list` → `orders-list`) and is only cosmetic: the id inside the file is the identity, and the name must end in it. Renaming a workflow renames its file; git's rename detection and the id keep that a clean change.
- Only the files above belong to APIWeave. A `README.md`, CI configuration or any other file you keep in the repository is left alone.

## Determinism

Every file is written the same way on every machine, so a change reviews as a small diff and two people's edits rarely touch the same lines:

- **Sorted keys** inside every object; the top-level fields keep a fixed order.
- **Sorted lists**: nodes by id, with a group frame before the nodes inside it; edges by id; each folder's files by id.
- **Positions rounded** to whole pixels, because the canvas needs them but not their fractions.
- **2-space indent, LF line endings and a trailing newline**; `.gitattributes` keeps git from converting them.
- **Nothing volatile**: no revision numbers, timestamps, run results or local paths.
- **Only changed files are written**, and a file with no record behind it is removed, so an unchanged workspace changes nothing.

The id is part of every file name, so two people creating "Get user" at the same time never collide on a path.

## Secrets

Secret values never reach a repository:

- `{{secrets.NAME}}` references stay as written, so the repository says which secrets a workflow uses and CI supplies each as `APIWEAVE_SECRET_<NAME>`.
- A credential typed straight into a request or a variable is withheld, the way an `.awecollection` export withholds it: it becomes `<SECRET>`, or a secret-named header is left out.
- Secret values, their ciphertext and keys, and the list of secret names stored on this machine are never written.
- Never written either: user-scoped environments, run history, node presets, agents, workflow revisions and an environment's base environment.

A request that sends `<SECRET>` comes from a withheld credential. Replace it with a `{{secrets.NAME}}` reference in the app; the next commit writes the reference.

## Track a workspace

1. Open **Settings → Workspace settings → Version history (git)**.
2. Click **Track this workspace**. The first commit holds the whole workspace.
3. Leave **Commit automatically** on, or turn it off to commit only with **Commit now**, optionally with a message. Left empty, the message names the files the commit changed.

If git does not know who you are, the panel asks for a name and email once and keeps them in this workspace's repository only; your global git configuration is not touched.

The repository is an ordinary git repository at `<userData>/git/<workspace id>/`; see [Installation](../getting-started/installation.md) for where `<userData>` is. It is browsable with any git tool, and only APIWeave should write there. **Stop tracking** deletes that repository and its commits; the workspace itself is not changed.

## Connect a remote

A tracked workspace can be connected to one remote repository on a git host, so its history is kept somewhere other than your machine.

1. Create an empty repository on your host (no README, no first commit).
2. In **Version history (git)**, paste its URL under **Remote URL** and click **Connect to remote**.

The URL takes one of four forms:

- `https://host/owner/repo.git`
- `ssh://git@host/owner/repo.git`
- `git@host:owner/repo.git` (the scp-like form `user@host:path`)
- `file:///path/to/repo.git`, for a repository on a drive or share

Plain `http://` and `git://` are refused, and so is a bare path such as `C:\repo` or `repo.git`, a URL with a query string or fragment, and a host or user name that starts with `-`.

What happens next depends on what the repository holds:

- **No branches at all:** the workspace's history is pushed to the `main` branch, once. This is the only push this release makes. It must be a bare repository (as every host creates), not a working copy somebody uses: git cannot push to a working copy's checked-out branch, and the connection is refused saying so.
- **Already holding this workspace's history** (a copy of the app's repository, for instance): it is joined as it is and nothing is pushed.
- **Holding history this workspace did not come from:** the connection is refused with `That repository already has history this workspace did not come from.` That includes a repository with history on another branch only, such as `master`: only one with no branches at all counts as empty. To work on a repository that already holds a workspace, [open it from git](#open-a-workspace-from-git) instead.
- **Unreachable, or refusing you:** the connection is refused with git's own message, and the workspace stays unconnected.

A refused connection leaves the workspace unconnected and its history untouched. The workspace's own repository is left with no remote, whatever it had. Git runs with its prompts off and uses your own configuration, so the host's credentials must already be available to it (an SSH key, or a credential helper that has signed in). Credentials never go in the URL: the URL is stored in plain text, in the app's database, in the repository's configuration and in the panel, so one that carries a user name or password (`https://user:token@host/…`) is refused. Use an SSH URL, or sign in through git's credential helper. The `git@` of an SSH URL is an account name, not a credential, and is accepted.

A workspace has one remote. **Disconnect** removes it after you confirm: every local commit stays, and nothing on the host is touched. To point a workspace at another repository, disconnect it and connect again.

Two things to know about the history that is pushed:

- The push creates `main`, but a new empty bare repository's own `HEAD` may name `master`. Someone cloning it then gets no checkout and must ask for the branch: `git clone --branch main <url>`.
- **Stop tracking** deletes the app's repository, and tracking again starts a new history. A remote that holds the old one has nothing in common with the new one, so the next connect refuses it as someone else's history. Connect a fresh empty repository instead.

## Open a workspace from git

A repository that holds a workspace (one a teammate pushed with [Connect a remote](#connect-a-remote), for example) can be opened here as a new workspace.

1. Open the workspace switcher at the top of the sidebar and choose **Open from git…**. When no workflow is open, the empty state has the same **Open from git…** button.
2. Paste the repository's URL, in any of the [accepted forms](#connect-a-remote), and click **Open workspace**.

What happens:

- The repository is cloned into a scratch folder first, and nothing is created in the app until it checks out. `.apiweave/format.json` must be there at a format version this APIWeave knows, and every file the format reads must be valid. Otherwise the open is refused, the message names the file and the problem, and nothing is left behind.
- The workspace is created with the id its `workspace.json` holds, and its projects, workflows and environments are imported. It is a workspace like one you made yourself, never your personal one. If another workspace already has its name's slug, the new one gets `-2` (then `-3`, and so on).
- The clone is moved to `<userData>/git/<workspace id>/`, and the workspace is tracked in **auto** mode, connected to that URL on the branch the clone is on. The app switches to it.
- Only the repository's **default branch** is opened. If it has branches but its default one has nothing to check out (a bare repository whose `HEAD` names `master` while the workspace is on `main`), the open is refused saying so; set the repository's default branch to the one that holds the workspace.
- Secret values are not in a repository, so the workspace starts with none: set the secrets its `{{secrets.NAME}}` references use, and replace any credential withheld as `<SECRET>`. When the import keeps one, the dialog lists the file or workflow it is in before switching. The workspace is already in your list by then: **Open workspace** switches to it, and **Close** leaves you where you are. See [Secrets](#secrets).

**A workspace that is already here.** Workspaces are identified by the id in `workspace.json`, not by their name or URL. If the repository's workspace is already in the app (the one you pushed from this machine, for instance), the repository is cloned into a scratch folder, checked, and removed again: nothing in the app changes. The dialog says **This workspace is already in APIWeave** and names it, and **Open it** takes you to that workspace; **Back** returns to the URL.

**Nothing syncs yet.** Opening is a one-time import. The workspace is tracked like any other, so your later edits are committed in its local clone, but the app does not fetch from or push to the repository: commits made there afterwards do not come in, and yours do not go out.

## Get a repository into CI

Connecting an empty repository puts the history on your host once. The app does not push after that, so this is the route for getting later changes from the app's repository to a pipeline. Clone the app's repository out of its data folder into a checkout of your own, and push **that clone** to your host:

```bash
git clone "<userData>/git/<workspace id>" my-tests    # your own copy; its origin is the app's repository
cd my-tests
git remote add host https://git.example.com/acme/my-tests.git
git push -u host HEAD
```

Run `apiweave run ./my-tests` there, or let your pipeline check out `host`. To bring in later changes, `git pull` inside the clone (its `origin` is the local path), then `git push host`. Only committed changes travel: in manual mode, use **Commit now** first.

**Do not add or change a remote inside the app's own repository** (`<userData>/git/<workspace id>`) by hand, and do not edit or commit in it: **Connect to remote** and **Disconnect** are how its remote is set. Only APIWeave writes there; it is the app's working copy, and the clone is the one that is yours.

## Run a repository in CI

`apiweave run` takes the repository folder directly, with the same importer the app uses, and never needs git installed:

```bash
apiweave run ./tests --env Staging                       # every project
apiweave run ./tests --project "Shop API" --env Staging  # one project
apiweave run ./tests --workflow "Login" --env Staging    # one workflow
```

- **Default: every project**, one after another, in the repository's own order (projects by id). A project with no enabled workflow is skipped with a line on stderr. A workflow that is in no project is not part of a default run: pick it with `--workflow`.
- `--project <name|id>` runs one project. An unknown or ambiguous name exits `2` and lists the projects.
- `--workflow <name|id>` runs one workflow, of the `--project` when given and of the whole repository otherwise, so it can reach a workflow that is in no project.
- `--env` picks one of the repository's environments by name; without it each workflow runs against the environment it was saved with.
- Exit code `0` when everything passed, `1` when a test failed, `2` for a usage or configuration error, such as a missing secret or an invalid file (the message names the file).
- `--bail` also stops the sequence at the first project that did not complete.

A `.awecollection` bundle, a single workflow export and a Postman collection still run with the same command. Every option, the reports and a GitHub Actions job are in [Run Tests in CI](ci.md).

## Not covered in this release

- **One push, then none.** Connecting to an empty repository pushes the history once. Later commits stay local, nothing is pulled, a diverged remote is not detected, and the branch is `main` with no way to change it.
- **No import after the first open.** [Opening a workspace from git](#open-a-workspace-from-git) reads a repository once. Nothing is pulled afterwards, so a workspace never picks up what others push, and there is no merge or conflict handling.
- **Environment inheritance is not carried.** An environment's base environment is not written; put the variables a run needs in the environment itself.
- **Local history stays separate.** A workflow's [version history](../features/workflows-and-nodes.md#version-history) in the app is not the git history.

## Troubleshooting

- **If tracking fails because git is not found**, install git and make sure it is on your `PATH`.
- **If connecting fails with an authentication error**, git could not sign in to the host without asking. Sign in once with your usual git tool (or add an SSH key to your agent), then connect again.
- **If connecting says `Commit the workspace once before connecting a remote.`**, the workspace has no commit yet, because git did not know who you are when tracking started. Enter a name and email when the panel asks, or use **Commit now**, then connect.
- **If connecting fails with `That repository already has history…`**, the repository already holds someone else's history. The workspace was left unconnected; create an empty repository and connect to that.
- **If opening says `.apiweave/format.json is missing: this is not an APIWeave workspace repository`**, the repository is empty or holds something other than a workspace. Check the URL, and that the workspace is on the repository's default branch.
- **If opening says `written by a newer APIWeave`**, the repository uses a format version this build does not read. Update APIWeave.
- **If opening names a file as invalid**, the file was edited by hand or has an unresolved merge conflict. Fix that file in the repository; the message names it and the problem.
- **If opening fails with `git clone failed`**, git's own message follows it: an unreachable host, a repository that does not exist, or a sign-in git could not complete without asking. Sign in once with your usual git tool, then try again.
- **If opening says a repository `is already at` a folder `and no workspace in this app claims it`**, `<userData>/git/<workspace id>/` holds a repository no workspace here owns, typically after restoring the app's database from a backup older than the workspace. It may hold commits that are not on the remote, so it is never removed for you. Restore the backup that has the workspace, or, once you are sure nothing in it is needed, move that folder out of `<userData>/git/` and open again. (A folder an open interrupted by a crash left behind is the app's own and is cleaned up on its own, at the next start or by opening again.)
- **If opening says a workspace `differs from` the repository's `only in letter case`**, the repository's workspace id equals one already here except for upper and lower case. Both would share one folder on Windows and macOS, so the open is refused. Change the `workspaceId` in the repository's `workspace.json`, or keep working in the workspace that is already here.
- **If opening says `Another program is holding files in the downloaded repository`**, something such as an antivirus scan or a file indexer had a file of the new clone open. Wait a moment and open again.
- **If a commit asks who you are**, enter a name and email in the panel; they are saved in this workspace's repository only.
- **If `apiweave run` says `.apiweave/format.json is missing`**, the folder is not a workspace repository. Point it at the folder that holds `.apiweave/`.
- **If `apiweave run` names a file as invalid**, the file was edited by hand or has an unresolved merge conflict. Fix that file; the message names it and the problem.
- **If a request sends `<SECRET>`**, the repository holds a withheld credential. Replace it with a `{{secrets.NAME}}` reference in the app.

## Related

- [Run Tests in CI](ci.md): every `apiweave run` option and a GitHub Actions job.
- [Projects](../features/projects.md): project runs and `.awecollection` bundles.
- [Environments and Secrets](../features/environments-and-secrets.md): secrets and how references resolve.
- [Workflows and Nodes: Version history](../features/workflows-and-nodes.md#version-history): a workflow's own saved versions.
