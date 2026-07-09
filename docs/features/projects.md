# Projects

*Group workflows so they run in a defined order, share a failure policy, and travel together as a single portable bundle. This doc covers the project lifecycle in APIWeave: create, fill, order, run, export, import, and re-validate.*

## Prerequisites

- At least one saved workflow. See [Workflows and Nodes](workflows-and-nodes.md).
- Familiarity with the `continueOnFail` per-workflow toggle, covered in [Variables, Extractors, and JSON Editor](variables-and-extractors.md) and revisited below.

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

A project is a named, ordered list of workflows plus a per-workflow `continueOnFail` flag. A project can hold any number of workflows. When you run a project, APIWeave walks the workflow list top to bottom against the environment you select and produces a single project run record that contains the result of every workflow in the group.

```text
Project: "Checkout API"
  1. Auth        (workflow)  continueOnFail: false
  2. Add to cart (workflow)  continueOnFail: false
  3. Pay         (workflow)  continueOnFail: true
```

Projects are the unit of export and import. The `.awecollection` file bundles every workflow in the project, plus the project metadata and environment references, in one portable archive. The bundle carries references only, never secret values, ciphertext, or per-scope private keys.

## Use Cases

Projects map directly to how teams organize test work. Three common patterns:

- **Feature grouping**: every workflow that covers the same feature area lives in one project. A "Checkout API" project contains the auth, cart, payment, and receipt workflows for checkout.
- **Release cycles**: group the smoke and regression workflows you want to run for a release. A "Release 2.4" project runs the same workflows in the same order against staging and production environments.
- **Team or service ownership**: assign one project per service boundary. You can then target the project for that service without running unrelated workflows.

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
3. The workflow joins the project with `continueOnFail = false` by default. Adjust the per-row flag afterwards.

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
- **Project-level `continueOnFail`** applies between workflows. When false (default), a failed workflow stops the project. When true, the project logs the failure and moves to the next workflow.

You usually want the project-level flag set to `true` for diagnostic workflows and `false` for critical paths. Example:

```text
Project: "Checkout API"
  1. Auth        workflow continueOnFail: false  project continueOnFail: false
  2. Add to cart workflow continueOnFail: false  project continueOnFail: false
  3. Pay         workflow continueOnFail: true   project continueOnFail: true
```

The runner reads the project-level flag after each workflow completes. You can change it row by row in the project settings.

## Project Run Behavior

A project run executes workflows sequentially in the configured order. Disabled workflows are skipped. The runner:

1. Creates a project run record that tracks the overall status and per-workflow results.
2. Runs the first enabled workflow using the environment selected for the run. The environment applies to every workflow in the project. Use the same environment for the whole project unless you specifically need different scopes per workflow.
3. Captures each workflow's run record and status.
4. If the workflow failed and the row's `continueOnFail` is `false`, marks the project run as failed and stops.
5. Otherwise, advances to the next enabled workflow.
6. Repeats until the list is exhausted or a stop condition fires.

Variable and secret state does not pass between workflows by default. If a downstream workflow needs a value produced by an earlier one, extract it into a workflow variable, promote it to an environment variable, or duplicate the value into a static variable.

## Export and Import (.awecollection)

Projects travel as `.awecollection` files. The file is a JSON archive with three sections:

- **Project metadata**: name, description, color, and workflow order.
- **Workflows**: every workflow attached to the project, in order, with nodes, edges, variables, and per-workflow settings.
- **Environment references**: identifiers of the environments the project depends on, plus the public key fingerprints the destination instance needs to re-create the secret bindings. No values, no ciphertext, no private keys.

To export:

1. Open the project in the project settings page.
2. Click **Export**.
3. Save the `.awecollection` file somewhere safe.

To import:

1. Open the projects list from the sidebar.
2. Click **Import project**.
3. Pick the `.awecollection` file.
4. Review the workflow list and the environment references.
5. Click **Import** to commit, or **Dry run** first (see below).

Imports always create new workflow records; existing workflows are not overwritten. If the import references an environment that already exists, the import re-uses it. If the referenced environment is missing, the import creates an empty environment shell with the same name and you fill in the variables and secrets through the normal flows.

## Dry-Run Validation

Before committing an import, run a dry-run pass. The dry-run reports what the import will create, conflict with, or skip, without writing anything to the database.

Typical dry-run output:

```text
Import plan for "Checkout API.awecollection":
  + Create workflow: Auth        (new)
  + Create workflow: Add to cart (new)
  + Create workflow: Pay         (new)
  + Reference environment: "Staging"  (matches existing env)
  ! Conflict: workflow "Pay" already exists (will create copy "Pay (2)")
```

If the dry-run shows only `+` lines, the import is clean and you can proceed. If it shows `!` lines, decide whether to import-as-copy or cancel and rename the workflows in the source bundle first.

## References Only (No Secrets in Bundles)

The `.awecollection` schema exports references only. The bundle does not carry:

- Secret values, in any form.
- Sealed-box ciphertext, because the destination instance has its own scope keypairs.
- Per-scope private keys. The destination instance derives its own keypair per scope on first secret write.

Concretely, the bundle looks like this for the secret side:

```json
{
  "schema": "awecollection/v2",
  "secretReferences": [
    {
      "name": "API_KEY",
      "scope": "user",
      "publicKeyFingerprint": "fp:abc123"
    }
  ]
}
```

The fingerprint tells the destination operator which scope the key should live in. The operator re-creates the value through the Libsodium write flow on the destination instance. After import, every `{{secrets.NAME}}` placeholder will resolve to nothing until you re-enter the value in the destination environment.

This is intentional. Each instance has its own Libsodium keypairs and its own envelope encryption key, and shipping ciphertext across would not help. The bundle is a portable shape, not a portable vault.

## Troubleshooting

- **If a workflow shows as "locked" inside a project and you cannot delete it from the project list**, open the workflow's Settings panel and set **Project** to `None`. Save. The workflow detaches and the project row disappears.
- **If the project runs in the wrong order after a drag-and-drop edit**, click **Save order** in the project settings. Drag-and-drop updates the list in memory but does not persist until you save. Reload the page to confirm the new order.
- **If secrets are missing after import**, open **Secrets** for the destination environment and add each referenced key through the Libsodium write flow. The `.awecollection` bundle references the secret names and scopes but never the values.
- **If a project run stops at the first failure but you expected it to continue**, check the per-row `continueOnFail` flag for the failing workflow in the project settings. The default is `false`, which stops the project.
- **If an imported workflow fails with `workflow not found` errors when another workflow references it**, the bundle exported with a stale internal ID. Re-export the project from the source instance, then re-import.

## Related

- [Workflows and Nodes](workflows-and-nodes.md)
- [Variables, Extractors, and JSON Editor](variables-and-extractors.md)
- [Concepts: Project](../getting-started/concepts.md#project)
- [Concepts: Environment](../getting-started/concepts.md#environment)
