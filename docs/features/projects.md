# Projects

*Group workflows so they run in a defined order, share a failure policy, and travel together as a single portable bundle. This doc covers the project lifecycle in APIWeave: create, fill, order, run, export, import, and re-validate.*

## Prerequisites

- At least one saved workflow. See [Workflows and Nodes](workflows-and-nodes.md).
- Familiarity with the `continueOnFail` toggle, covered in [Workflows and Nodes](workflows-and-nodes.md#canvas-actions) and revisited below.

## Table of Contents

- [What is a Project](#what-is-a-project)
- [Use Cases](#use-cases)
- [Creating a Project](#creating-a-project)
- [Adding Workflows to a Project](#adding-workflows-to-a-project)
- [Reordering Workflows](#reordering-workflows)
- [continueOnFail per Workflow](#continueonfail-per-workflow)
- [Project Run Behavior](#project-run-behavior)
- [Export and Import (.awecollection)](#export-and-import-awecollection)
- [Dry-Run Validation](#dry-run-validation)
- [References Only (No Secrets in Bundles)](#references-only-no-secrets-in-bundles)
- [Troubleshooting](#troubleshooting)
- [Related](#related)

## What is a Project

A project is a named, ordered list of workflows plus a per-workflow `continueOnFail` flag. A project can hold any number of workflows. Projects are the unit of export and import: the `.awecollection` file bundles every workflow in the project, plus the project metadata and environment references, in one portable archive. The bundle carries references only, never secret values, ciphertext, or private keys.

```text
Project: "Checkout API"
  1. Auth        (workflow)  continueOnFail: true
  2. Add to cart (workflow)  continueOnFail: true
  3. Pay         (workflow)  continueOnFail: false
```

One-click ordered project runs are on the roadmap; today you run each workflow on its own from the canvas.

## Use Cases

Projects map directly to how you organize test work. Three common patterns:

- **Feature grouping**: every workflow that covers the same feature area lives in one project. A "Checkout API" project contains the auth, cart, payment, and receipt workflows for checkout.
- **Release cycles**: group the smoke and regression workflows you want to run for a release. A "Release 2.4" project runs the same workflows in the same order against staging and production environments.
- **Service ownership**: assign one project per service boundary. You can then target the project for that service without running unrelated workflows.

A workflow can belong to at most one project at a time. If you need parallel groupings, duplicate the workflow and assign the copies to different projects.

## Creating a Project

1. Open the projects list from the sidebar.
2. Click **Create project**.
3. Fill in a name, optional description, and choose a color tag.
4. Save.

The new project appears in the sidebar with an empty workflow list. You can edit the name, description, and color later from the project settings.

```text
Project: "Checkout API"
  description: End-to-end checkout flow
  color:       green
  workflows:   (empty)
```

## Adding Workflows to a Project

Workflows are attached from the workflow side, not from the project side. Two ways to do it:

**From the workflow settings panel** (recommended):

1. Open the workflow on the canvas.
2. Open the right-side panel and switch to **Settings**.
3. In the **Project** field, pick a project from the dropdown. The dropdown lists the projects on your machine.
4. Save. The workflow now appears in that project's workflow list.

**From the project settings**:

1. Open the project in the project settings page.
2. Click **Add workflow** and pick from the workflows that are not yet assigned.
3. The workflow joins the project with `continueOnFail = true` by default. Adjust the per-row flag afterwards.

To remove a workflow from a project, return to the workflow's Settings panel and set **Project** back to `None`, or use **Remove** in the project settings.

A workflow can only belong to one project. Reassigning it to a different project removes it from the first.

## Reordering Workflows

Order matters: the runner executes workflows in the order shown in the project settings. To change the order:

1. Open the project in the project settings page.
2. In the workflow list, grab the drag handle on the left of a row.
3. Drop it in the new position. The list updates immediately.
4. Click **Save order** to persist.

Each row also has an **Enabled** toggle. Disabled workflows are skipped during a project run, and they stay in the list so the order remains stable across runs. Use this to keep optional steps (such as a cleanup or a slow smoke check) ready without reordering.

```text
Project: "Checkout API" (saved order)
  1. [x] Auth
  2. [x] Add to cart
  3. [ ] Visual regression  (disabled, kept in place)
  4. [x] Pay
```

## continueOnFail per Workflow

Each row in the project's workflow list carries a `continueOnFail` flag. The flag is independent from the workflow's own `continueOnFail` setting on the canvas:

- **Workflow-level `continueOnFail`** applies to nodes inside that workflow. When false (default), the first failing node stops the workflow.
- **Project-level `continueOnFail`** records the intent for when ordered project runs ship: continue to the next workflow after a failure (true, the default), or stop the project (false).

You usually want the project-level flag set to `true` for diagnostic workflows and `false` for critical paths. Example:

```text
Project: "Checkout API"
  1. Auth        workflow continueOnFail: false  project continueOnFail: true
  2. Add to cart workflow continueOnFail: false  project continueOnFail: true
  3. Pay         workflow continueOnFail: true   project continueOnFail: false
```

You can change the project-level flag row by row in the project settings.

## Project Run Behavior

One-click project runs are planned but not available in this release: there is no runner that executes a whole project in order. The project list defines the order, the enabled/disabled state, and the per-workflow `continueOnFail` intent; until the project runner ships, run each workflow from its own canvas, in project order, using the environment you want.

Variable and secret state does not pass between workflows. If a downstream workflow needs a value produced by an earlier one, extract it into a workflow variable, promote it to an environment variable, or duplicate the value into a static variable.

## Export and Import (.awecollection)

Projects travel as `.awecollection` files. The file is a JSON archive with three sections:

- **Project metadata**: name, description, color, and workflow order.
- **Workflows**: every workflow attached to the project, in order, with nodes, edges, variables, and per-workflow settings.
- **Environment references**: the environments the project depends on, with their plain variables, plus the secret references the destination operator must re-create. No secret values, no ciphertext, no private keys.

To export:

1. Open the project in the project settings page.
2. Click **Export**.
3. Save the `.awecollection` file somewhere safe.

To import:

1. Open the projects list from the sidebar.
2. Click **Import project** and pick or paste the `.awecollection` file.
3. Click **Validate** for the dry-run report (see below).
4. Click **Import** to commit.

Imports always create new workflow records; existing workflows are not overwritten. Every environment referenced by the bundle is created fresh on the destination, carrying the bundle's plain variables — an existing environment with the same name is not re-used or merged.

## Dry-Run Validation

Before committing an import, run the validation pass. It reports what the import will create without writing anything to the database: it validates the bundle schema, lists the workflows and environments that will be created, counts any secret references that will be unresolved after import, and warns when the bundle's schema version is newer than this app understands.

Typical dry-run output:

```text
Import plan for "Checkout API.awecollection":
  + Create workflow: Auth        (new)
  + Create workflow: Add to cart (new)
  + Create workflow: Pay         (new)
  + Create environment: "Staging" (from the bundle's variables)
  ! 3 secret references will be unresolved after import; re-enter them locally
```

If the dry-run shows only `+` lines, the import is clean and you can proceed. If it shows `!` lines, decide whether to proceed and re-create the missing secrets on the destination, or cancel.

## References Only (No Secrets in Bundles)

The `.awecollection` schema exports references only. The bundle does not carry:

- Secret values, in any form.
- Sealed-box ciphertext, because the destination instance has its own install keypair.
- Private keys. Each install derives its own single keypair from the local keyfile.

Concretely, the bundle looks like this for the secret side:

```json
{
  "schemaVersion": "2.0",
  "type": "awecollection",
  "secretReferences": [
    {
      "name": "API_KEY",
      "scopeType": "workspace"
    }
  ]
}
```

The reference tells the destination operator which scope the key should live in. The operator re-creates the value through the Libsodium write flow on the destination instance. After import, every `{{secrets.NAME}}` placeholder will resolve to nothing until you re-enter the value in the destination scope.

This is intentional. Each instance has its own Libsodium keypair and its own encryption key, and shipping ciphertext across would not help. The bundle is a portable shape, not a portable vault.

## Troubleshooting

- **If a workflow row in the project will not go away**, click **Remove** on the row, or open the workflow's Settings panel and set **Project** to `None`. Save. The workflow detaches and the project row disappears.
- **If the project runs in the wrong order after a drag-and-drop edit**, click **Save order** in the project settings. Drag-and-drop updates the list in memory but does not persist until you save. Reload the page to confirm the new order.
- **If secrets are missing after import**, open **Secrets** for the destination environment or workspace and add each referenced key through the Libsodium write flow. The `.awecollection` bundle references the secret names and scopes but never the values.
- **If an imported workflow fails with `workflow not found` errors when another workflow references it**, the bundle exported with a stale internal ID. Re-export the project from the source instance, then re-import.

## Related

- [Workflows and Nodes](workflows-and-nodes.md)
- [Variables, Extractors, and JSON Editor](variables-and-extractors.md)
- [Concepts: Project](../getting-started/concepts.md#project)
- [Concepts: Environment](../getting-started/concepts.md#environment)
