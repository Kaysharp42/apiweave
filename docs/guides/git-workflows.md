# Keep Tests in a Git Repository

*How a workspace is written as a git repository: the layout of its files, why they diff and merge well, what never reaches them, and how to run one in CI. For teams that want their API tests next to the code they test.*

> **In this release.** APIWeave tracks a workspace in a local git repository and commits to it: **Settings → Workspace → Version history (git)** has **Track this workspace**, a **Commit automatically** switch, **Sync now**, **Connect to remote** and **Stop tracking**. That repository lives on your machine, in the app's data folder. Connect a remote and the workspace keeps itself in step with it: after each commit the app fetches the remote's branch, fast-forwards and imports it when the remote moved alone, merges the two field by field when both moved, and pushes your commits. A second computer can [open the same workspace](#open-a-workspace-from-git) against the same remote and sync with it. The header shows [where the workspace stands](#the-sync-status-in-the-header) — synced, pending, syncing, incoming, merge needed, diverged, read-only or an error — in words and an icon, never colour alone. When both sides changed, non-overlapping edits survive as a real merge commit; a field both sides changed differently waits for a decision, and nothing is overwritten. When the host refuses your push, the workspace becomes read-only and keeps committing locally. `apiweave run` runs a repository's files in CI, so a checkout of the connected repository is all a pipeline needs.

## Prerequisites

- Git installed on the machine. APIWeave runs your own `git`, so its credential helpers and your configured author apply.
- Secrets referenced as `{{secrets.NAME}}`, not typed into requests. A repository never holds secret values; see [Secrets](#secrets).

## How it works

APIWeave keeps everything in its local database, and the database stays the source of truth. A tracked workspace is also written as a tree of JSON files, a projection of the database that is the same on every machine, and each change to the workspace becomes a commit of that tree. In **auto** mode (the default) a commit is made about 30 seconds after your last edit; in **manual** mode only **Sync now** commits (a workspace with no remote calls it **Commit now**), after showing what it is about to commit. Nothing is committed when the tree has not changed.

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

1. Open **Settings → Workspace → Version history (git)**.
2. Click **Track this workspace**. The first commit holds the whole workspace.
3. Leave **Commit automatically** on, or turn it off to commit only when you choose: **Sync now** (**Commit now** while there is no remote) lists what changed and takes an optional message — see [Manual mode](#manual-mode-the-commit-dialog). Left empty, the message names the files the commit changed.

If git does not know who you are, the panel asks for a name and email once and keeps them in this workspace's repository only; your global git configuration is not touched.

The repository is an ordinary git repository at `<userData>/git/<workspace id>/`; see [Installation](../getting-started/installation.md) for where `<userData>` is. It is browsable with any git tool, and only APIWeave should write there. **Stop tracking** deletes that repository and its commits; the workspace itself is not changed.

## Connect a remote

A tracked workspace can be connected to one remote repository on a git host, so its history is kept somewhere other than your machine and other machines can sync with it.

1. Create an empty repository on your host (no README, no first commit) — or let APIWeave create it: see [Create the repository from APIWeave](#create-the-repository-from-apiweave).
2. In **Version history (git)**, paste its URL under **Remote URL** and click **Connect to remote**.

### Create the repository from APIWeave

With a GitHub or GitLab account signed in (see [Git accounts](#git-accounts)), **Create repository…** next to **Connect to remote** does both steps:

1. Choose the **Account** to create it as, and the **Owner**: the account itself, or one of its GitHub organizations or the GitLab groups where it is at least a Developer.
2. The **Repository name** starts as the workspace's slug. It may hold letters and digits, with single `.`, `_` or `-` between them; it cannot end in `.git` or `.atom`.
3. **Visibility** is **Private** unless you choose **Public**.
4. **Create and connect** creates an empty repository — no README, licence or first commit — tags it with the topic `apiweave-workspace`, and connects the workspace to it. An HTTPS account is bound to the connection, so every sync uses its token; an SSH account connects by the SSH URL, with your SSH key.

A name that already exists is refused, naming the repository; APIWeave never connects to a repository it did not just create empty. If the repository was created but connecting to it fails, the message says so, the repository is kept — APIWeave never deletes one — and the connect form is filled in with it, so **Connect to remote** tries again. If the topic could not be added, the panel says so; the repository works without it.

The URL takes one of four forms:

- `https://host/owner/repo.git`
- `ssh://git@host/owner/repo.git`
- `git@host:owner/repo.git` (the scp-like form `user@host:path`)
- `file:///path/to/repo.git`, for a repository on a drive or share

Plain `http://` and `git://` are refused, and so is a bare path such as `C:\repo` or `repo.git`, a URL with a query string or fragment, and a host or user name that starts with `-`.

What happens next depends on what the repository holds:

- **No branches at all:** the workspace's history is pushed to the `main` branch, and the connection becomes the workspace's sync target. It must be a bare repository (as every host creates), not a working copy somebody uses: git cannot push to a working copy's checked-out branch, and the connection is refused saying so.
- **Already holding this workspace's history** (a copy of the app's repository, for instance): it is joined as it is, and the app syncs both ways from then on.
- **Holding history this workspace did not come from:** the connection is refused with `That repository already has history this workspace did not come from.` That includes a repository with history on another branch only, such as `master`: only one with no branches at all counts as empty. To work on a repository that already holds a workspace, [open it from git](#open-a-workspace-from-git) instead.
- **Unreachable, or refusing you:** the connection is refused with git's own message, and the workspace stays unconnected.

A refused connection leaves the workspace unconnected and its history untouched. The workspace's own repository is left with no remote, whatever it had. Git runs with its prompts off and uses your own configuration, so the host's credentials must already be available to it (an SSH key, or a credential helper that has signed in). Credentials never go in the URL: the URL is stored in plain text, in the app's database, in the repository's configuration and in the panel, so one that carries a user name or password (`https://user:token@host/…`) is refused. Use an SSH URL, or sign in through git's credential helper. The `git@` of an SSH URL is an account name, not a credential, and is accepted.

A workspace has one remote. **Disconnect** removes it after you confirm: every local commit stays, and nothing on the host is touched. To point a workspace at another repository, disconnect it and connect again.

Two things to know about the history that is pushed:

- The push creates `main`, but a new empty bare repository's own `HEAD` may name `master`. Someone cloning it then gets no checkout and must ask for the branch: `git clone --branch main <url>`.
- **Stop tracking** deletes the app's repository, and tracking again starts a new history. A remote that holds the old one has nothing in common with the new one, so the next connect refuses it as someone else's history. Connect a fresh empty repository instead.

## Git accounts

APIWeave signs in to GitHub and GitLab with their own command-line tools, [`gh`](https://cli.github.com) and [`glab`](https://gitlab.com/gitlab-org/cli), which keep the tokens in your system keychain; APIWeave stores none. A workspace connected over `https://` can sync as one of their accounts instead of whatever your credential helper answers with, which is how two accounts on one host each push to their own repositories.

- **The accounts menu** is the round button at the right end of the header. It shows the initials of the account the current workspace syncs as (a plain person icon when it has none), with the workspace's sync icon as a small badge. Open it to see every account by host, which one this workspace uses, **Add GitHub account** and **Add GitLab account**, and a link to the settings page. For a workspace that is not tracked yet, or has no remote, it also offers **Set up sync for this workspace…**, which opens its Version history. The accounts are read from `gh` and `glab` each time the menu opens.
- **Settings → App → Git accounts** says whether each tool is installed, with where to get it when it is not, and any problem a tool reported (an expired sign-in, a tool that did not answer). It lists each account with the workspaces that sync as it, and signs in to another. **Refresh** asks the tools again, after a sign-in made in a terminal for instance.
- **GitLab keeps one account per host.** `glab` stores one token per host, so signing in to a GitLab host it already has replaces that account. Two GitLab accounts need two hosts (`gitlab.com` and a self-hosted instance, say). `gh` keeps several accounts per host.

Signing in runs the tool's own browser sign-in: the dialog shows the one-time code and opens the page to enter it on. Without `gh` or `glab`, nothing changes: connect a remote by its URL, signed in with your own git credentials.

## Sync with the remote

A connected workspace syncs by itself. In **auto** mode, about 30 seconds after your last edit the app commits the workspace and then runs a full cycle:

1. **Fetch** the remote's branch.
2. **Integrate**: when only the remote moved, fast-forward the clone to it and import its records into the database, so the two computers see the same projects, workflows and environments. When both sides moved, merge them by record, node and field; a merge without conflicts becomes a real two-parent commit, which is imported and then pushed like any other change. The workspace list, the sidebar, an open project page and the environments page refresh as the import lands, as they do for an agent's write. If the app is closed or stops between moving the clone and finishing the import, the next start puts the clone back where the database is and the import runs again, so the remote's change is never committed away.
3. **Push** this device's commits. If the remote moved in the meantime, the app fetches once more, brings it in, and pushes again; a rejection that only means the remote is ahead is retried this way. If the remote moves yet again during that retry, the sync stops with an error and pushes nothing; the next sync (the next automatic one, or **Retry**) fetches and merges again.

The app also runs a cycle when it launches and every 5 minutes while it is open. In **manual** mode an edit schedules no commit; the launches and the interval only fetch, so the workspace knows how many remote changes are waiting, and **Sync now** commits and syncs when you choose. When that sync stops short (a merge that needs a decision, an abandoned merge, a refused push or an unreachable remote), the commit still happened locally, and the header and the panel show why the sync stopped.

**Merging.** If both this device and the remote gained commits since they last agreed, the app merges them by record, node and field. Edits that touch different things are combined, positions take the remote's, and an edge whose node the other side deleted is dropped — the commit message lists what the merge settled that way. The result is a real merge commit with both sides' history as parents, so nothing either side committed is lost, and the next push carries it. Where the same field changed differently on each side, the workspace stops at **merging** (`Merge needed` in the header): nothing is pushed and nothing is imported, and **Review merge** opens [the picker](#resolving-a-merge) for each conflicted record and file. Every change that did not conflict is already part of the merge, and both sides stay on this device and the remote until it is settled. While it waits, auto-commit pauses: edits you make are saved but not committed; resolving commits them first and redoes the merge on top of them, so they are neither overwritten nor lost. Settling the last conflict commits the merge, imports it and pushes in one step. **Abandon merge** in the picker gives up the merge without giving up a commit: the workspace becomes **diverged**, and **Sync now** offers the merge again. While it is diverged, auto mode still commits your edits on this device, the ones made while the merge waited first; it only stops merging and pushing until you choose **Sync now**. A crash or a quit while a merge waits changes nothing — the three commits and any decisions already sent with **Finish merge** are stored, and the conflicts are recomputed at the next start. The exception is a history folder that was deleted: the next start recreates it from the workspace as a new history the remote does not share, so the merge is dropped and the next sync stops with an error that says so (see [Troubleshooting](#troubleshooting)). Disconnecting the remote drops a waiting merge too; your commits and edits stay.

**Read-only.** A host can refuse a push, because you have no write access or because the branch is protected. The app then marks the workspace read-only: your edits save and commit locally as usual, the remote's commits still come in, and the automatic cycles push nothing, but **Retry** still attempts the push, in either mode. Only a push that sends commits and succeeds clears read-only, because that is what proves the host accepts you again; a sync with nothing to send pushes nothing and leaves it set. The remote's commits come in only while this device has none of its own: once you edit a read-only workspace, those local commits never leave it. A later remote change is still merged in and imported, with the merge committed locally, but the push that follows is refused again, so the workspace stays read-only with unpushed commits until a push succeeds. The refusal's message stays in the panel through later commits and pulls. Another failure, such as a fetch that fails, replaces it with its own message, and once that failure is over the panel shows no message; the workspace stays read-only either way.

## The sync status in the header

A tracked workspace shows its state at the right of the header, as an icon and a word, so it never depends on colour alone. Click it for an explanation of the state and what to do about it, when the workspace last synced, its last commit, and a link to **Version history settings**. A workspace that is not tracked shows nothing.

| State | Shown when | What the popover offers |
| --- | --- | --- |
| **Synced** | Nothing is waiting either way. | **Sync now** |
| **Pending** | This device has work the remote does not: edits not yet committed, or commits not yet pushed. The label adds `(N to push)` when only commits are waiting. | **Sync now** |
| **Syncing** | A cycle is running. | — |
| **Incoming (N)** | Manual mode, and the remote has `N` new commits this device has not brought in. | **Sync now** brings them in |
| **Merge needed** | Both this device and the remote changed, and some fields were changed differently on each side. Nothing is pushed or imported until each conflict is settled. | **Review merge** opens the picker; **Discard local changes** loads the remote's version instead |
| **Diverged** | You abandoned a merge. Every local commit is kept and nothing was pushed. | **Sync now** merges again, **Discard local changes** |
| **Read-only** | The host refused your push: *You can't push to this repo — your changes stay on this device.* If a later sync also failed, that failure is told after it, with git's text as detail; the state stays Read-only. | **Retry**, **Discard local changes** |
| **Sync error** | The last cycle failed; the message says why and what to do (below). | **Retry** |

**Retry** is **Sync now** under another name: in manual mode with edits waiting it opens the same commit dialog first.

A workspace with no remote says **Local history** (or **Local history · uncommitted** while edits are waiting), **Committing** or **Commit error**, and offers **Commit now** only when there is something to commit: there is nothing to push.

**Pending is a flag with a count only where the count is known.** Whether the database holds edits the last commit does not is known cheaply and stays right across restarts, so **Pending** always shows. How many records changed means serializing the whole workspace and comparing it with the last commit, which is too much to repeat on every status, so it is not shown in the header: **Pending (N to push)** counts commits waiting for the remote, and the exact list of changed workflows, projects and environments is what [the commit dialog](#manual-mode-the-commit-dialog) shows.

**Discard local changes** always asks first: it throws away every local commit and every change not yet committed, and loads the remote's version of the workspace in its place — a record you added here and never committed is gone too. It cannot be undone. It is offered from the header for a merging, diverged or read-only workspace, and always from the settings panel while a remote is connected.

### Manual mode: the commit dialog

In manual mode, **Sync now** with edits waiting opens a dialog before anything is committed. It lists what the commit would hold by the records' names, not file paths — *Added workflow "Checkout"*, *Changed environment "Prod"*, *Deleted project "Billing"* — and has a **Commit message** field. Leave the message empty and the commit names the files it changed. **Commit and sync** (**Commit** with no remote) then commits, fetches, brings in what the remote has and pushes. A deleted record is named from the last commit, because the record itself is gone. The list is worked out in memory against the last commit and writes nothing into the repository, so looking at it, or cancelling it, changes nothing. Renaming a record is one *Changed* line, not a deletion and an addition. With nothing waiting, **Sync now** just syncs. In auto mode **Sync now** syncs straight away.

### Resolving a merge

**Review merge** opens the picker over whatever you were doing — from the header's popover or from **Version history settings** — and closing it changes nothing in the workspace. Choices are only stored when **Finish merge** sends them, so closing loses decisions you have not sent; decisions sent by a finish that then left conflicts are kept, and reopening starts from them.

It lists one card per conflicted record or file. Each conflicted place shows both copies side by side under **Your copy** and **Remote copy**; a copy that side deleted or never had says *Not present*. Under each place are **Keep your copy** and **Keep remote copy**; a *Whole record* or *Whole file* place has no buttons of its own, because the card's header buttons settle it. The card's header has **Keep your copy for all conflicts** and **Keep remote copy for all conflicts** for the whole record: one choice there settles every **conflicted** field in it and clears that record's earlier field choices, while every other change from both sides is already merged. A field choice overrides the record choice for that field only. In the card's header are the author, short commit and subject of the commit each side last made to it, read from the merge's two commits; if those details cannot be read the card says *Commit details unavailable* and the choices still work. A record whose two copies cannot make a valid record together says why and offers only the whole-record choice.

**Finish merge** is enabled only when every listed conflict has a decision, and sends all of them together. A resolve that leaves conflicts — because the merge was redone on top of edits made while it waited, for instance — lists what is left and keeps the decisions already made, so the next **Finish merge** sends the complete set again; a failure says why and keeps the decisions, so a retry costs nothing. When the last conflict is settled, the merge commit is created, imported and pushed.

**Abandon merge** asks first, because it is the deliberate way out: every local commit and change stays on this device, nothing is pushed, and the workspace becomes **Diverged**. **Sync now** then merges again.

### What the error messages say

| Failure | Message |
| --- | --- |
| Git is not installed | *Git isn't installed — install Git and restart APIWeave.* |
| Git does not know who you are | *Git doesn't know who you are on this machine — enter your name and email in the workspace's version history settings.* The popover links there, and offers no Retry until you have. |
| The host did not accept your credentials | *Sign-in to github.com failed — your credential manager will ask again on retry.* |
| The host refused a fetch or a clone | *github.com refused access to this repo — check the URL, and that you're signed in with an account that can read it.* A refused *push* is not an error: it makes the workspace read-only (above). |
| The host cannot be reached | *Can't reach github.com — check your connection. APIWeave retries every 5 minutes.* |
| The host did not answer in time | *github.com took too long to answer — check your connection and retry.* |
| The remote moved at the same moment | *Someone pushed to the remote at the same moment — retry to bring their changes in first.* |
| The local history folder is gone or damaged | *This workspace's history folder on this device is missing or damaged. If it is missing, restarting APIWeave recreates it; if it is damaged, stop tracking the workspace in its version history settings and track it again.* |
| The remote address or branch name is unusable | *APIWeave can't use this remote address or branch name — check them in the workspace's version history settings.* |
| Anything else git reported | *Git reported an error APIWeave doesn't recognise — retry, and see the details below if it persists.* |

The host in the message is the one in the remote's URL (`github.com` for `https://github.com/…` and `git@github.com:…` alike), or "the remote" when the URL names none. Git's own text for the failure is shown under the message as detail. A failure that is not git's — a repository file that does not validate — shows its own message.

### Where the settings are

**Settings → Workspace → Version history (git)** holds the same state and actions as the header's popover, plus the **Commit automatically** switch, the **Remote** and its **Branch**, **Connect to remote** or **Disconnect**, and **Stop tracking**. The branch is shown, not chosen; see [Not covered](#not-covered-in-this-release).

## Open a workspace from git

A repository that holds a workspace (one a teammate pushed with [Connect a remote](#connect-a-remote), for example) can be opened here as a new workspace.

1. Open the workspace switcher at the top of the sidebar and choose **Open from git…**. When no workflow is open, the empty state has the same **Open from git…** button.
2. Paste the repository's URL, in any of the [accepted forms](#connect-a-remote), and click **Open workspace**.

What happens:

- The repository is cloned into a scratch folder first, and nothing is created in the app until it checks out. `.apiweave/format.json` must be there at a format version this APIWeave knows, and every file the format reads must be valid. Otherwise the open is refused, the message names the file and the problem, and nothing is left behind.
- The workspace is created with the id its `workspace.json` holds, and its projects, workflows and environments are imported. It is a workspace like one you made yourself, never your personal one. If another workspace already has its name's slug, the new one gets `-2` (then `-3`, and so on).
- The clone is moved to `<userData>/git/<workspace id>/`, and the workspace is tracked in **auto** mode, connected to that URL on the branch the clone is on. The app switches to it.
- Only the repository's **default branch** is opened. If it has branches but its default one has nothing to check out (a bare repository whose `HEAD` names `master` while the workspace is on `main`), the open is refused saying so; set the repository's default branch to the one that holds the workspace.
- Secret values are not in a repository, so the workspace starts with none: set the secrets its `{{secrets.NAME}}` references use, and replace any credential withheld as `<SECRET>`. When the import has something to report — a withheld credential, or a default environment it had to pick — the dialog lists it before switching; with nothing to report it switches straight away. The workspace is already in your list by then: **Open workspace** switches to it, and **Close** leaves you where you are. See [Secrets](#secrets).

**A workspace that is already here.** Workspaces are identified by the id in `workspace.json`, not by their name or URL. If the repository's workspace is already in the app (the one you pushed from this machine, for instance), the repository is cloned into a scratch folder, checked, and removed again: nothing in the app changes. The dialog says **This workspace is already in APIWeave** and names it, and **Open it** takes you to that workspace; **Back** returns to the URL.

**It syncs from then on.** The open imports the repository once, and the workspace is tracked in **auto** mode and connected to that URL on the branch the clone is on, so later cycles push your commits and bring in other people's exactly as for any connected workspace; see [Sync with the remote](#sync-with-the-remote).

## Get a repository into CI

Connecting a remote is all a pipeline needs: the app pushes every committed change to it, so a checkout of the connected repository holds the workspace files with the commit subjects as their history. Clone it anywhere and run the repository folder:

```bash
git clone <your remote url> my-tests
apiweave run ./my-tests
```

Only committed changes travel: an auto-mode workspace commits about 30 seconds after your last edit, and in manual mode **Sync now** is what commits and pushes.

**Do not add or change a remote inside the app's own repository** (`<userData>/git/<workspace id>`) by hand, and do not edit or commit in it: **Connect to remote** and **Disconnect** are how its remote is set. Only APIWeave writes there; it is the app's working copy.

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

- **The branch is fixed.** A workspace syncs the branch its repository is on — `main` for one this app created, or the repository's default branch for one opened from git — and there is no branch picker.
- **Environment inheritance is not carried.** An environment's base environment is not written; put the variables a run needs in the environment itself.
- **Local history stays separate.** A workflow's [version history](../features/workflows-and-nodes.md#version-history) in the app is not the git history.

## Troubleshooting

- **If tracking fails because git is not found**, install git and make sure it is on your `PATH`.
- **If connecting fails with an authentication error**, git could not sign in to the host without asking. Sign in once with your usual git tool (or add an SSH key to your agent), then connect again.
- **If connecting says `Commit the workspace once before connecting a remote.`**, the workspace has no commit yet, because git did not know who you are when tracking started. Enter a name and email when the panel asks, then connect.
- **If connecting fails with `That repository already has history…`**, the repository already holds someone else's history. The workspace was left unconnected; create an empty repository and connect to that.
- **If a sync says `The remote's branch holds history this workspace did not come from…`**, the remote's branch was replaced by unrelated history, or this device's history folder was deleted and recreated. The two cannot be merged, and nothing was pushed. **Discard local changes** loads the remote's version; disconnecting the remote keeps this device's.
- **If a sync names a file as `a symbolic link` or `a submodule`**, the remote added or changed a link or a submodule (another repository) at that path. A merge carries links and submodules as they are, never as files: one both sides hold alike, or one the remote left as it was, stays as this device has it, and one the remote removed is removed here too. It never takes a new or changed one from the remote, because that would mean writing it into this device's copy, so it refuses the merge before writing anything, and nothing is pushed. Remove the entry on the remote, or put it back as it was, with your usual git tool, then sync again; or **Discard local changes** to take the remote's version as it is.
- **If a sync names a path as `not a path a repository may hold`**, a commit on one side holds a path into git's own `.git` folder. The merge refuses that commit before writing anything, and nothing is pushed. Remove the entry from the repository with your usual git tool, then sync again.
- **If the header says Merge needed**, both sides changed the same field differently. **Review merge** lists them; keep your copy or the remote's for each field, or for a whole record or file at once. The rest of both sides' changes are already combined, and settling the last conflict commits, imports and pushes the merge. If you would rather decide later, leave it — the merge survives restarts — or **Abandon merge**: every local commit stays, **Sync now** offers the merge again, and **Discard local changes** is still the way to match the remote.
- **If the header says Read-only (a push was refused)**, the host does not accept pushes from your account to that repository, or the branch is protected. The workspace stays read-only — local commits continue, and the remote's changes still come in, merged and committed locally — and read-only clears on the next push that sends commits and succeeds. Check that your account can write to the repository and that the branch is not protected. A fetch the host refuses is not this: it shows as an error, and the workspace is not marked read-only.
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
