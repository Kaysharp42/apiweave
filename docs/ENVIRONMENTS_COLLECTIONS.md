# Environments, Secrets, and Collections

Use environments to parameterize requests, secrets to protect sensitive values, and collections to organize workflows.

## Environments

Open Environment Manager from the top header (`Environments`).

Each environment can include:

- name and description
- variables (for `{{env.NAME}}` placeholders)
- secrets (entered at run time)
- optional Swagger/OpenAPI URL

## Create an Environment

1. Open Environment Manager.
2. Click `New Environment`.
3. Set name and description.
4. Add variables (key/value).
5. Optionally set Swagger/OpenAPI URL.
6. Save.

Example environment variables:

- `BASE_URL=https://api.staging.example.com`
- `API_VERSION=v1`

Then use them in requests:

```text
{{env.BASE_URL}}/users
```

## Secrets

Secrets are values you do not want to store in plain workflow config.

- Manage secret keys in Environment Manager (`Manage Secrets`).
- At run time, APIWeave prompts for missing secret values.
- Entered values are stored in browser session storage.

Use secrets in requests:

```text
{{secrets.API_KEY}}
{{secrets.CLIENT_SECRET}}
```

## Duplicate and Delete Environment

- `Duplicate` creates a copy with variables, secrets keys, and Swagger URL.
- Delete is blocked if workflows still reference that environment.

## Collections

Collections group related workflows.

Use them for:

- feature-based grouping
- release-cycle grouping
- team or service ownership grouping

## Create and Edit Collections

1. Open Collections view in sidebar.
2. Click `Create` or open Collection Manager.
3. Set name, description, and color.
4. Save.

## Assign Workflow to Collection

From a workflow tab:

1. Open right-side panel.
2. Go to `Settings`.
3. In `Collections`, choose a collection.
4. Remove assignment from the same area if needed.

## Collection Workflow Order

In Collection Manager, use the workflow order view to:

- reorder workflows by drag and drop
- enable or disable items
- set per-item continue/stop behavior
- save order for collection execution scenarios

## Export and Import

### Workflow Export/Import

- Export a workflow from workflow actions.
- Import workflow JSON into APIWeave.
- Optional environment data can be included.

### Collection Export/Import

- Export collection bundles (`.awecollection`) with workflows.
- Optional environment export is supported.
- Dry-run validation is available before import.

Sensitive values are sanitized in exports and replaced with placeholders where needed.

After import, re-enter required secrets before running in sensitive environments.
