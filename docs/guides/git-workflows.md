# Keep Tests in a Git Repository

*How to export a project to a folder of JSON files, commit it, review changes as diffs, pull a teammate's changes back into the app, and run the same folder in CI. For teams that want their API tests next to the code they test.*

## Prerequisites

- A project with the workflows you want to keep. See [Projects](../features/projects.md).
- A git repository (or any folder) to export into.
- Secrets referenced as `{{secrets.NAME}}`, not typed into requests. The folder never holds secret values; see [Secrets](#secrets).

## How it works

APIWeave stores everything in its local database. **Export to Folder** writes one project as plain JSON files that diff and merge well; **Import from Folder** reads them back into the same project, matched by id. `apiweave run <folder>` runs the folder in CI with no database at all.

```text
apiweave/
├── project.json               # name, workflow order, enabled / continue on fail, the files below, secret names
├── workflows/
│   ├── login.json             # one file per workflow
│   └── orders-list.json
└── environments/
    └── staging.json           # one file per environment the workflows use: variables only
```

The format is the same data as an `.awecollection` bundle, split per workflow and written deterministically:

- **One workflow per file**, so two people editing two workflows never touch the same file.
- **Stable order**: keys sorted inside every object (the top-level fields keep a fixed order), nodes sorted by id with a group frame before the nodes inside it, edges sorted by id, workflows listed in `project.json` in the project's run order.
- **Nothing volatile**: no revision numbers, timestamps, run results or workspace ids. Node positions stay, rounded to whole pixels, because the canvas needs them.
- **2-space indent and a trailing newline.** Exporting an unchanged project rewrites nothing, and changing one node changes only that node's lines in that workflow's file.
- **Ids are the identity.** Every workflow, environment and the project keep their ids; a file name is just the slug of the name (`Orders / list` → `orders-list.json`). Renaming a workflow renames its file. Two workflows with the same slug get the id appended to the second one's file name.

`project.json` looks like this:

```json
{
  "format": "apiweave-project",
  "version": 1,
  "projectId": "01K6Z4D1V3N8Q2J5W7X9Y0A1B2",
  "name": "Shop API",
  "description": "",
  "color": "#3B82F6",
  "workflows": [
    { "workflowId": "01K6Z4F0M2...", "file": "workflows/orders-list.json", "enabled": true, "continueOnFail": false },
    { "workflowId": "01K6Z4E8K7...", "file": "workflows/login.json", "enabled": true, "continueOnFail": true }
  ],
  "environments": [
    { "environmentId": "01K6Z4C9P1...", "file": "environments/staging.json" }
  ],
  "secrets": ["API_TOKEN"]
}
```

## Export a project to a folder

1. In the sidebar, open the project's actions and click **Export project**.
2. Click **Export to Folder…** and pick a folder, for example `apiweave/` in your repository. Create it from the picker if it does not exist.
3. Commit the folder.

To update the folder later, export again into the same folder. APIWeave rewrites the files that changed, leaves the others untouched, and removes the files of workflows that were deleted from the project or renamed. It only ever removes files the previous `project.json` listed: a `README.md`, a `.gitignore` or anything else you keep in the folder stays.

The export refuses, without writing anything, when:

- the folder's `project.json` belongs to another project. Each project gets its own folder.
- a file it would write already exists and the previous `project.json` does not list it. Move that file away, or pick another folder.

## Import a folder

After a `git pull`, bring the changes into the app:

1. In the sidebar's **Import** menu for projects, click **Collection**.
2. Click **Import from Folder…** and pick the folder.

The import makes the project match the folder, matched by id:

- A workflow the folder has and the workspace does not is created with the folder's id. So is the project, and each environment.
- A workflow that changed is rewritten through the normal save path, so its previous version is kept in its [version history](../features/workflows-and-nodes.md#version-history) with the source **import**. An open canvas picks up the change.
- A workflow whose file matches what an export would write is left alone: no new version, no change to its revision.
- A workflow in the project that the folder no longer has is moved out of the project, not deleted. You find it among the workspace's workflows outside any project, and the import result names it.
- An environment's variables are replaced by the folder's; its secrets are not touched.

A folder maps to one workspace. Importing it into a second workspace is refused, because its ids already exist in the first; to copy a project into another workspace, export it as an `.awecollection` bundle and import that instead.

## Secrets

Secret values never reach the folder:

- `{{secrets.NAME}}` references stay as written, and `project.json` lists every name the project uses under `secrets`. Add each one on every machine that runs the project: in the app (an import result lists the ones missing from the workspace), or as `APIWEAVE_SECRET_<NAME>` in CI.
- A credential typed straight into a request or a variable is withheld, the way an `.awecollection` export withholds it: it becomes `<SECRET>`, or a secret-named header is left out.

A withheld value survives a round trip as long as nobody changes that part of the workflow: when a node's config, a variable or an environment variable in the folder reads exactly as the export wrote it, the import keeps the stored value. When it was changed in the folder, the folder's version wins and the credential is gone from that node; the import warns about any `<SECRET>` placeholder it stored, and the version before the import is in the workflow's history. Move such credentials to secrets before you share the folder.

## Work as a team

1. Each person keeps the project in APIWeave and the folder in the repository.
2. After editing in the app, **Export to Folder**, review the diff, and commit.
3. After pulling, **Import from Folder** so the app sees the teammates' changes.

Because each workflow is its own file and every file is written the same way on every machine, most merges are automatic. Two people changing the same workflow conflict in that one file, on the lines they both changed; resolve it like any JSON conflict and import the result. A file left with conflict markers fails the import with "not valid JSON (an unresolved merge conflict?)" and changes nothing. Adding workflows on two branches touches the `workflows` list in `project.json` on both; keep both entries.

Export before you pull if you have unexported changes: an import replaces a workflow's content with the folder's (its previous version stays in history, but it is not merged).

## Run the folder in CI

`apiweave run` takes the folder directly, with the same importer the app uses:

```bash
apiweave run ./apiweave --env Staging
apiweave run ./apiweave --workflow "Login" --env Staging
```

Every option of [Run Tests in CI](ci.md) works the same way. Secrets come from `APIWEAVE_SECRET_<NAME>`, `--secret` or `--secrets-file`.

## Not covered

- **No linked folder.** Export and import are one-shot actions; nothing watches the folder or exports on save. Export when you want to commit, import after you pull.
- **One project per folder.** A whole workspace is several folders, one per project.
- **Environment inheritance is not carried.** An environment's base environment is not exported, as with `.awecollection` bundles; put the variables a run needs in the environment itself.
- **Version history stays local.** The folder holds the current version; git holds the history of the folder.

## Troubleshooting

- **If the export says the folder holds another project**, you picked the folder of a different project. Pick that project's folder or an empty one.
- **If the export refuses to overwrite a file**, a file with the same name exists but is not listed in `project.json`. Move it, or pick another folder.
- **If the import says the ids already belong to another workspace**, this folder was imported into another workspace before. Import it there, or use an `.awecollection` bundle to copy the project.
- **If `project.json` is not an APIWeave project file**, it was edited by hand or written by a newer APIWeave. The message names the field at fault. A `file` entry must be directly under `workflows/` or `environments/`.
- **If a request sends `<SECRET>`**, the folder holds a withheld credential. Replace it with a `{{secrets.NAME}}` reference in the app and export again.

## Related

- [Projects](../features/projects.md): project runs and `.awecollection` bundles.
- [Run Tests in CI](ci.md): every `apiweave run` option and a GitHub Actions job.
- [Environments and Secrets](../features/environments-and-secrets.md): secrets and how references resolve.
- [Workflows and Nodes: Version history](../features/workflows-and-nodes.md#version-history): what an import keeps of the version it replaces.
