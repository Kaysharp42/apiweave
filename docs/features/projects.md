# Projects

*Group workflows so they run in a defined order, share a failure policy, and travel together as a single portable bundle. This doc covers the project lifecycle in APIWeave: create, fill, order, run, export, import, and re-validate.*

## Prerequisites

- At least one saved workflow. See [Workflows and Nodes](workflows-and-nodes.md).
- Familiarity with the per-node **Continue on failure** toggle, covered in [Workflows and Nodes](workflows-and-nodes.md#canvas-actions).

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

Click **Run project** on the project page to run every enabled workflow in that order against one environment. See [Project Run Behavior](#project-run-behavior).

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

Each row in the project's workflow list carries a `continueOnFail` flag. It decides what a project run does when that workflow fails: go on to the next workflow (true, the default), or stop the project run there (false). It is independent of the per-node **Continue on failure** toggles inside the workflow, which decide whether a failing node stops that workflow's run.

You usually want the flag set to `true` for diagnostic workflows and `false` for critical paths. Example:

```text
Project: "Checkout API"
  1. Auth        continueOnFail: true
  2. Add to cart continueOnFail: true
  3. Pay         continueOnFail: false
```

Change it row by row in **Manage Workflows**: each row's **Continue** / **Stop** button flips it. Click **Save order** to keep the change.

## Project Run Behavior

To run a project:

1. Open the project page from the sidebar.
2. In **Project runs**, pick the **Environment** every workflow runs against. The workspace default is preselected; **No environment** runs them with none.
3. Click **Run project**.

The project run executes the enabled workflows one at a time, in the saved order. Each workflow's run is an ordinary run: it appears in that workflow's History, masks secrets, and stops when cancelled, exactly like a run started from the canvas. The card lists every workflow of the run with its status (pending, running, passed, failed, cancelled, interrupted or skipped) and duration. **Open run** opens that workflow's canvas with History on its run.

What happens when a workflow does not pass:

- **Failed, row set to Continue**: the project run goes on to the next workflow. The project run still ends **Failed**.
- **Failed, row set to Stop**: the project run stops. The workflows after it are **Skipped**.
- **Cancelled**: **Cancel** on the card (or cancelling the workflow's own run from its canvas) cancels the running workflow, skips the rest, and ends the project run **Cancelled**.
- **Interrupted**: quitting APIWeave mid-run ends the project run **Interrupted**. It is not resumed on the next launch.

The order comes from **Manage Workflows**. A workflow added to the project after the order was last saved runs after the ordered ones. Disabled workflows are not run and do not appear in the project run.

Once a project run has finished, **JUnit XML** and **HTML report** on the card export it, with one test suite per workflow; see [Run reports](visualization-and-debugging.md#5-run-reports-junit-and-html).

The card also lists the project's earlier runs; click one to see its workflows. APIWeave keeps the newest 50 finished project runs per project. Each workflow's own run follows that workflow's History retention, so an old project run can point at a workflow run that has since been pruned.

Variable and secret state does not pass between workflows: each workflow starts from its own variables and the chosen environment, as it would from the canvas. If a downstream workflow needs a value produced by an earlier one, extract it into a workflow variable, promote it to an environment variable, or duplicate the value into a static variable.

A CI pipeline can run an exported `.awecollection` the same way, without the app: `apiweave run project.awecollection --env Staging`. See [Run Tests in CI](../guides/ci.md).

An agent connected over MCP can start a project run with `projects_run` and follow it with `projects_getRun`. A workflow in an agent's project run that would send stored secrets waits for your approval first, as any agent-started run does. See [MCP Integration](mcp-integration.md).

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

A Postman collection imports into a new project from the same menu (**Import → Postman**); see [Migrate from Postman](../guides/migrating-from-postman.md).

A Call Workflow node follows its target into the import: when the target is in the same bundle, the node points at the imported copy. A target outside the bundle is kept when it exists in the destination workspace, and cleared otherwise; the import result lists every cleared target so you can pick a new one. A single workflow export carries none of its targets, so the same rule applies to each of its Call Workflow nodes.

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
- **If a Call Workflow node fails with `no target workflow configured` after an import**, its target was neither in the bundle nor in the destination workspace, so the import cleared it. Import the target too, or pick another target.

## Related

- [Workflows and Nodes](workflows-and-nodes.md)
- [Variables, Extractors, and JSON Editor](variables-and-extractors.md)
- [Concepts: Project](../getting-started/concepts.md#project)
- [Concepts: Environment](../getting-started/concepts.md#environment)
