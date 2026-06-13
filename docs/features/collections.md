# Collections

*Group workflows so they run in a defined order, share a failure policy, and travel together as a single portable bundle. This doc covers the collection lifecycle: create, fill, order, export, import, and re-validate.*

## Prerequisites

- At least one saved workflow. See [Workflows and Nodes](WORKFLOWS_AND_NODES.md).
- Familiarity with the `continueOnFail` per-workflow toggle, covered in [Variables, Extractors, and JSON Editor](VARIABLES_EXTRACTORS_JSON_EDITOR.md) and revisited below.
- Optional: an environment to attach for collection runs. See [Concepts: Environment](getting-started/concepts.md#environment).

## Table of Contents

- [What is a Collection](#what-is-a-collection)
- [Use Cases](#use-cases)
- [Creating a Collection](#creating-a-collection)
- [Adding Workflows to a Collection](#adding-workflows-to-a-collection)
- [Reordering Workflows](#reordering-workflows)
- [continueOnFail per Workflow](#continueonfail-per-workflow)
- [Collection Run Behavior](#collection-run-behavior)
- [Export and Import](#export-and-import)
- [Dry-Run Validation](#dry-run-validation)
- [Secret Sanitization](#secret-sanitization)
- [Troubleshooting](#troubleshooting)
- [Related](#related)

## What is a Collection

A collection is a named, ordered list of workflows plus a per-workflow `continueOnFail` flag. When you run a collection, APIWeave walks the list top to bottom and produces a single `CollectionRun` record that contains the result of every workflow in the group.

```text
Collection: "Checkout API"
  1. Auth        (workflow)  continueOnFail: false
  2. Add to cart (workflow)  continueOnFail: false
  3. Pay         (workflow)  continueOnFail: true
```

Collections are the unit of export and import. The `.awecollection` file bundles every workflow in the collection, plus an optional environment snapshot, in one portable archive.

## Use Cases

Collections map directly to how teams organize test work. Three common patterns:

- **Feature grouping**: every workflow that covers the same feature area lives in one collection. A "Checkout API" collection contains the auth, cart, payment, and receipt workflows for checkout.
- **Release cycles**: group the smoke and regression workflows you want to run for a release. A "Release 2.4" collection runs the same workflows in the same order on staging and production.
- **Team or service ownership**: assign one collection per service boundary or owning team. CI can then target the collection for that service without running unrelated workflows.

A workflow can belong to at most one collection at a time. If you need parallel groupings, duplicate the workflow and assign the copies to different collections.

## Creating a Collection

1. Open the **Collections** view from the sidebar.
2. Click **Create**.
3. Fill in name, optional description, and choose a color tag.
4. Save.

The new collection appears in the sidebar with an empty workflow list. You can edit name, description, and color later from the Collection Manager.

```text
Collection: "Checkout API"
  description: End-to-end checkout flow
  color:       green
  workflows:   (empty)
```

## Adding Workflows to a Collection

Workflows are attached from the workflow side, not from the collection side. Two ways to do it:

**From the workflow settings panel** (recommended):

1. Open the workflow on the canvas.
2. Open the right-side panel and switch to **Settings**.
3. In the **Collection** field, pick a collection from the dropdown.
4. Save. The workflow now appears in that collection's workflow list.

**From the Collection Manager**:

1. Open the collection in the Collection Manager.
2. Click **Add Workflow** and pick from the workflows that are not yet assigned.

To remove a workflow from a collection, return to the workflow's Settings panel and set **Collection** back to `None`, or use **Remove** in the Collection Manager.

A workflow can only belong to one collection. Reassigning it to a different collection removes it from the first.

## Reordering Workflows

Order matters: the runner executes workflows in the order shown in the Collection Manager. To change the order:

1. Open the collection in the Collection Manager.
2. In the workflow list, grab the drag handle on the left of a row.
3. Drop it in the new position. The list updates immediately.
4. Click **Save Order** to persist.

Each row also has an **Enabled** toggle. Disabled workflows are skipped during a collection run, and they stay in the list so the order remains stable across runs. Use this to keep optional steps (such as a cleanup or a slow smoke check) ready without reordering.

```text
Collection: "Checkout API" (saved order)
  1. [x] Auth
  2. [x] Add to cart
  3. [ ] Visual regression  (disabled, kept in place)
  4. [x] Pay
```

## continueOnFail per Workflow

Each row in the collection's workflow list carries a `continueOnFail` flag. The flag is independent from the workflow's own `continueOnFail` setting on the canvas:

- **Workflow-level `continueOnFail`** applies to nodes inside that workflow. When false (default), the first failing node stops the workflow.
- **Collection-level `continueOnFail`** applies between workflows. When false (default), a failed workflow stops the collection. When true, the collection logs the failure and moves to the next workflow.

You usually want the collection-level flag set to `true` for diagnostic workflows and `false` for critical paths. Example:

```text
Collection: "Checkout API"
  1. Auth        workflow continueOnFail: false  collection continueOnFail: false
  2. Add to cart workflow continueOnFail: false  collection continueOnFail: false
  3. Pay         workflow continueOnFail: true   collection continueOnFail: true
```

The runner reads the collection-level flag after each workflow completes. You can change it row by row in the Collection Manager.

## Collection Run Behavior

A collection run executes workflows sequentially in the configured order. Disabled workflows are skipped. The runner:

1. Creates a `CollectionRun` record that tracks the overall status and per-workflow results.
2. Runs the first enabled workflow using the active environment (or the one assigned to the workflow).
3. Captures the workflow's `Run` record and status.
4. If the workflow failed and the row's `continueOnFail` is `false`, marks the collection run as failed and stops.
5. Otherwise, advances to the next enabled workflow.
6. Repeats until the list is exhausted or a stop condition fires.

Variable and secret state does not pass between workflows by default. If a downstream workflow needs a value produced by an earlier one, extract it into a workflow variable and pass it through a shared environment, or duplicate the value into a static variable.

## Export and Import

Collections travel as `.awecollection` files. The file is a JSON archive with two optional sections:

- **Workflows**: every workflow attached to the collection, in order.
- **Environment**: an optional snapshot of an environment, included only if you tick the box at export time.

To export:

1. Open the Collection Manager for the collection.
2. Click **Export**.
3. Optionally select an environment to bundle.
4. Save the `.awecollection` file somewhere safe.

To import:

1. Open **Import Collection** from the Collections view.
2. Pick the `.awecollection` file.
3. Review the workflow list and any included environment.
4. Click **Import** to commit, or **Dry Run** first (see below).

Imports always create new workflow records; existing workflows in the target APIWeave instance are not overwritten. If the import includes an environment, a new environment record is created with the same name unless you check the **Replace existing** option.

## Dry-Run Validation

Before committing an import, run a dry-run pass. The dry-run reports what the import will create, conflict with, or skip, without writing anything to the database.

Typical dry-run output:

```text
Import plan for "Checkout API.awecollection":
  + Create workflow: Auth        (new)
  + Create workflow: Add to cart (new)
  + Create workflow: Pay         (new)
  + Create environment: Checkout (new)
  ! Conflict: workflow "Pay" already exists in target instance (will create copy "Pay (2)")
```

If the dry-run shows only `+` lines, the import is clean and you can proceed. If it shows `!` lines, decide whether to import-as-copy or cancel and rename the workflows in the source bundle first.

## Secret Sanitization

Exports remove secret values. The `.awecollection` file keeps environment **keys** (so you know which secret to fill in) but replaces every secret **value** with a placeholder like `<SECRET>`.

This means:

- An exported collection is safe to commit, share, or upload.
- After import, every `{{secrets.NAME}}` placeholder will resolve to nothing until you re-enter the value in the imported environment.
- Open the imported environment in Environment Manager, set each secret value, save, then run the collection.

The same rule applies to workflow-level values that look like secrets (API keys, tokens, passwords). The export pipeline runs the same key-name detection as the runtime masking logic, so values that match `api_key`, `token`, `password`, `*_secret`, and similar patterns are scrubbed before writing the bundle.

If a workflow ran fine before export but fails after import with `{{secrets.X}}` resolving to empty, the secret value was sanitized at export. Re-enter it on the target instance.

## Troubleshooting

- **If a workflow shows as "locked" inside a collection and you cannot delete it from the collection list**, open the workflow's Settings panel and set **Collection** to `None`. Save. The workflow detaches and the collection row disappears.
- **If the collection runs in the wrong order after a drag-and-drop edit**, click **Save Order** in the Collection Manager. Drag-and-drop updates the list in memory but does not persist until you save. Reload the page to confirm the new order.
- **If secrets are missing after import**, open the imported environment in Environment Manager and re-enter each value. Exports sanitize secret values to `<SECRET>` placeholders, so the imported environment has the right keys but empty values.
- **If a collection run stops at the first failure but you expected it to continue**, check the per-row `continueOnFail` flag for the failing workflow in the Collection Manager. The default is `false`, which stops the collection.
- **If an imported workflow fails with `workflow not found` errors when another workflow references it**, the bundle exported with a stale internal ID. Re-export the collection from the source instance, then re-import.

## Related

- [Workflows and Nodes](WORKFLOWS_AND_NODES.md)
- [Variables, Extractors, and JSON Editor](VARIABLES_EXTRACTORS_JSON_EDITOR.md)
- [Webhook Quick Start](WEBHOOK_QUICKSTART.md)
- [Concepts: Collection](getting-started/concepts.md#collection)
- [Concepts: Environment](getting-started/concepts.md#environment)
