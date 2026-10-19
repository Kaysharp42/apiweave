# Keep Tests in a Git Repository

*How a workspace is written as a git repository: the layout of its files, why they diff and merge well, what never reaches them, and how to run one in CI. For teams that want their API tests next to the code they test.*

> **In this release.** APIWeave tracks a workspace in a local git repository and commits to it: **Settings → Workspace settings → Version history (git)** has **Track this workspace**, a **Commit automatically** switch, **Commit now** (with an optional message) and **Stop tracking**. That repository lives on your machine, in the app's data folder. This release does **not** push, pull or import: there is no remote to set, and nothing reads a repository back into the app. `apiweave run` runs a repository's files in CI, so a checkout of one is all a pipeline needs.

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

## Get a repository into CI

Until a release can push for you, this is the route from the app's repository to a pipeline. Clone the app's repository out of its data folder into a checkout of your own, and push **that clone** to your host:

```bash
git clone "<userData>/git/<workspace id>" my-tests    # your own copy; its origin is the app's repository
cd my-tests
git remote add host https://git.example.com/acme/my-tests.git
git push -u host HEAD
```

Run `apiweave run ./my-tests` there, or let your pipeline check out `host`. To bring in later changes, `git pull` inside the clone (its `origin` is the local path), then `git push host`. Only committed changes travel: in manual mode, use **Commit now** first.

**Do not add a remote inside the app's own repository** (`<userData>/git/<workspace id>`), and do not edit or commit in it. Only APIWeave writes there; it is the app's working copy, and the clone is the one that is yours.

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

- **No remote.** Nothing pushes or pulls, and a repository is not imported back into the app.
- **Environment inheritance is not carried.** An environment's base environment is not written; put the variables a run needs in the environment itself.
- **Local history stays separate.** A workflow's [version history](../features/workflows-and-nodes.md#version-history) in the app is not the git history.

## Troubleshooting

- **If tracking fails because git is not found**, install git and make sure it is on your `PATH`.
- **If a commit asks who you are**, enter a name and email in the panel; they are saved in this workspace's repository only.
- **If `apiweave run` says `.apiweave/format.json is missing`**, the folder is not a workspace repository. Point it at the folder that holds `.apiweave/`.
- **If `apiweave run` names a file as invalid**, the file was edited by hand or has an unresolved merge conflict. Fix that file; the message names it and the problem.
- **If a request sends `<SECRET>`**, the repository holds a withheld credential. Replace it with a `{{secrets.NAME}}` reference in the app.

## Related

- [Run Tests in CI](ci.md): every `apiweave run` option and a GitHub Actions job.
- [Projects](../features/projects.md): project runs and `.awecollection` bundles.
- [Environments and Secrets](../features/environments-and-secrets.md): secrets and how references resolve.
- [Workflows and Nodes: Version history](../features/workflows-and-nodes.md#version-history): a workflow's own saved versions.
