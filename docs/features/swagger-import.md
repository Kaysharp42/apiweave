# Swagger and OpenAPI Import

*How to turn an OpenAPI or Swagger document into reusable request templates inside APIWeave. Covers the environment-linked sync that keeps templates fresh as the spec evolves, the one-time file import for ad-hoc projects, the warning badge for stale nodes, and the versions the importer accepts.*

## Prerequisites

- [Concepts](../getting-started/concepts.md), especially the Environment and Workflow definitions.
- [Environments and Secrets](environments-and-secrets.md), because the Swagger URL lives on an environment document.
- [Workflows and Nodes](workflows-and-nodes.md) so the HTTP Request node and the Add Nodes panel are familiar.
- A working APIWeave instance and at least one environment. See [Installation](../getting-started/installation.md) if you have not set it up yet.

## Table of Contents

- [Two Import Paths](#two-import-paths)
- [Path A: Environment-Linked Swagger Sync](#path-a-environment-linked-swagger-sync)
  - [Step 1: Set the Swagger URL on an Environment](#step-1-set-the-swagger-url-on-an-environment)
  - [Step 2: Select the Environment and Refresh](#step-2-select-the-environment-and-refresh)
  - [Step 3: Drag Imported Requests to the Canvas](#step-3-drag-imported-requests-to-the-canvas)
- [The `Check API` Warning Badge](#the-check-api-warning-badge)
- [Path B: OpenAPI File Import](#path-b-openapi-file-import)
- [Multi-Definition Swagger UI](#multi-definition-swagger-ui)
- [Supported Versions](#supported-versions)
- [Troubleshooting](#troubleshooting)
- [Related](#related)

## Two Import Paths

APIWeave gives you two ways to get endpoints from an OpenAPI or Swagger document onto the canvas. Pick the one that matches your situation.

| Path | Best when | What it does |
| --- | --- | --- |
| **Path A: Environment-Linked Sync** | The API definition changes often and you want the templates on the canvas to stay in step with the spec. | The Swagger URL is pinned on an environment. The canvas toolbar has a **Refresh** action that re-fetches the document and refreshes the imported group. |
| **Path B: One-Time File Import** | You have a local `.json` or `.yaml` spec file and just want to drop a batch of templates onto the canvas for a one-off workflow. | The **Import** panel accepts a file, shows a preview, and adds the endpoints to the Add Nodes palette. There is no ongoing sync. |

Path A is the recommended default for any API you keep touching. Path B is the right tool for a quick prototype, a one-shot migration, or a spec that lives only on your laptop.

## Path A: Environment-Linked Swagger Sync

The environment-linked path keeps the template set in sync with a remote spec. The trade-off is that you must keep the URL on the environment up to date; if the API team moves the spec, you update the URL once and every workflow that uses that environment picks up the new templates on the next refresh.

### Step 1: Set the Swagger URL on an Environment

The Swagger URL is a field on the environment document, not a workflow setting. That choice is what makes it possible to swap the spec per stage (staging spec on one environment, production spec on another) without touching the canvas.

1. Open **Environments** from the top header.
2. Create a new environment or open the one you want to attach the spec to.
3. Find the **OpenAPI/Swagger URL** field and paste the spec URL. Both of these URL shapes are accepted:

   ```text
   Direct spec URL:        https://api.example.com/v3/api-docs
   Direct spec URL:        https://api.example.com/swagger/v1/swagger.json
   Swagger UI landing URL: https://api.example.com/swagger-ui/index.html
   Swagger UI landing URL: https://api.example.com/webjars/swagger-ui/index.html
   ```

4. Save the environment.

The URL must be reachable from the APIWeave backend, not just from your browser. If the backend runs behind a private network, the spec has to be on a host the backend can reach. See [Environments and Secrets](environments-and-secrets.md#openapiswagger-url) for the field's full context.

### Step 2: Select the Environment and Refresh

Now switch to the canvas and pull the spec into the Add Nodes panel.

1. Open the workflow you want to add endpoints to (or create a new one).
2. In the canvas toolbar, open the environment selector and pick the environment you just configured.
3. Click **Refresh** in the toolbar. The importer fetches the document, parses the operations, and adds an imported group to the Add Nodes panel.

The imported group is labeled `Swagger: <Environment Name>` so you can tell at a glance which spec the templates came from. Repeat the click whenever the spec changes upstream; the group is regenerated each time.

### Step 3: Drag Imported Requests to the Canvas

1. Open the **Add Nodes** panel (the plus button at the bottom-right of the canvas).
2. Find the `Swagger: <Environment Name>` group.
3. Drag an HTTP Request template onto the canvas. Each template comes pre-filled with the method, URL, parameters, and body shape from the operation in the spec.
4. Double-click the node to adjust headers, body, timeouts, or extractors. Placeholders like `{{env.BASE_URL}}` work in every field, so the imported request is usable against your active environment with no further wiring.

Imported templates are a starting point, not a finished node. Treat them the same as any other HTTP Request node: configure auth, plug in extractors, and attach assertions where the contract matters.

## The `Check API` Warning Badge

When you refresh, the importer does two things:

- It updates the templates in the Add Nodes panel so the latest spec is one drag away.
- It scans the canvas for HTTP Request nodes that were originally imported from the same spec and compares each one against the new operation.

If a node no longer matches the refreshed spec, APIWeave pins a `Check API` badge on the node. Open the badge to see the mismatch reason, the timestamp of the last successful refresh, and the source Swagger URL the comparison ran against.

Important: a refresh never overwrites the request body, headers, parameters, or other configuration on a node you already edited. The badge is the signal that the node and the spec have drifted, and you decide how to reconcile them. Common reconciliation moves:

- Update the URL or method to match the renamed or reshaped operation in the new spec.
- Add or remove parameters that the new spec now requires or no longer supports.
- Leave the node as is if the drift is intentional (you are calling a deprecated path on purpose).

## Path B: OpenAPI File Import

Use the file path when you have a spec on disk and do not need ongoing sync.

1. Open the **Import** panel from the canvas toolbar.
2. Choose **OpenAPI** as the import source.
3. Upload a `.json` or `.yaml` spec file from your computer.
4. Click **Preview** to see the operations the importer extracted.
5. Optionally pick a server URL, filter by tags, or enable sanitization for the request body.
6. Click **Add to Nodes**. The endpoints are added to the Add Nodes panel as a new palette group.

The group added by Path B is local to the workflow. It does not depend on any environment, does not refresh, and does not generate `Check API` badges. If the spec on disk changes, run the import again.

## Multi-Definition Swagger UI

Some teams expose a single Swagger UI page that lists more than one API definition (think of a gateway that fronts several services). APIWeave handles that case by discovering every definition the page advertises and importing operations from each one.

In practice that means:

- All definitions are imported.
- Endpoints from each definition land in the same `Swagger: <Environment Name>` group, tagged with the definition name when one is available.
- Partial failures are surfaced. If one definition fails to parse or fetch, the others still import and the failing definition is reported so you can fix it upstream without losing the working imports.

If a definition keeps failing, paste its direct spec URL into the environment's URL field instead of the Swagger UI landing URL. The direct URL skips the discovery step and goes straight to the JSON the importer expects.

## Supported Versions

| Spec version | Supported |
| --- | --- |
| OpenAPI 3.0 and newer (3.0, 3.1) | Yes |
| Swagger 2.0 | Yes |
| Swagger 1.0 | No. Deprecated upstream; the importer rejects Swagger 1.0 documents. Migrate the source spec to OpenAPI 3.0 if you control it, or ask the API team to publish a 2.0/3.x spec. |

The importer also handles both `.json` and `.yaml` documents and accepts URLs that point either at a raw spec or at a Swagger UI page (Path A only).

## Troubleshooting

- **If Refresh reports "Select an environment before refreshing Swagger"**, open the environment selector in the canvas toolbar and pick one. The importer needs an environment to read the Swagger URL from.
- **If Refresh reports "Environment has no Swagger/OpenAPI URL"**, open the Environment Manager, edit the active environment, and paste the spec URL into the **OpenAPI/Swagger URL** field. See [Environments and Secrets](environments-and-secrets.md#openapiswagger-url) for the exact field.
- **If Refresh reports "Failed to fetch Swagger URL"**, confirm the URL starts with `http://` or `https://`, that the APIWeave backend can reach the host (not just your browser), and that the host is not on a private network the backend blocks. If a Swagger UI URL fails, try the direct spec URL for the same service.
- **If only some endpoints import from a multi-definition Swagger UI**, one of the definitions is failing while the others succeed. Keep the successful imports, then point the environment's URL at the failing definition's direct spec URL to isolate it.
- **If a `Check API` badge stays on a node after a refresh**, the importer found a real drift between the node and the refreshed spec. Open the badge for the mismatch reason and either bring the node in line with the spec or accept the drift intentionally.
- **If Path B's Preview shows zero operations**, the file is not a valid OpenAPI 3.x or Swagger 2.0 document. Open the file and confirm the top-level keys (`openapi` for 3.x, `swagger: "2.0"` for 2.0) are present.

## Related

- [Environments and Secrets](environments-and-secrets.md) for the per-environment Swagger URL field and environment management.
- [Workflows and Nodes](workflows-and-nodes.md) for the HTTP Request node and the Add Nodes panel that imported requests land in.
- [Concepts](../getting-started/concepts.md) for the Environment, Variable, and Workflow terms used throughout this guide.
- [Troubleshooting](../operations/troubleshooting.md) for the central FAQ when an issue is not import-specific.
