# Swagger and OpenAPI Import Guide

Use this guide to import API request templates from Swagger/OpenAPI and keep them in sync with your environment.

## Two Import Paths

APIWeave supports two common flows:

1. Environment-linked Swagger sync (recommended for ongoing work)
2. One-time OpenAPI file import to Add Nodes panel

## Path A: Environment-Linked Swagger Sync

Best when your API definition changes over time.

## Step 1: Set Swagger/OpenAPI URL on Environment

1. Open `Environments`.
2. Create or edit an environment.
3. Set `Swagger / OpenAPI URL`.
4. Save.

Supported URL examples:

- Direct spec URL:
  - `https://api.example.com/v3/api-docs`
  - `https://api.example.com/swagger/v1/swagger.json`
- Swagger UI landing URL:
  - `https://api.example.com/swagger-ui/index.html`
  - `https://api.example.com/webjars/swagger-ui/index.html`

## Step 2: Select Environment and Refresh

1. In the canvas toolbar, choose the environment.
2. Click `Refresh`.
3. APIWeave loads request templates into Add Nodes.

The imported group appears as:

- `Swagger: <Environment Name>`

## Step 3: Drag Imported Requests

Open Add Nodes and drag imported HTTP requests to the canvas.

These requests include method, URL, and request template fields from the spec.

## Warning Badge: `Check API`

If an existing schema-linked HTTP node no longer matches the refreshed spec, APIWeave shows `Check API` on that node.

Open the badge to see:

- mismatch reason
- last refresh timestamp
- source Swagger URL

Important: refresh does not overwrite your existing node request body/headers/config.

## Path B: OpenAPI File Import (One-Time)

Best when you have a local spec file and want quick template generation.

1. In sidebar, open import menu.
2. Choose `OpenAPI`.
3. Upload `.json` spec file.
4. Click `Preview`.
5. Optionally choose server URL, tags, and sanitization.
6. Click `Add to Nodes`.

Imported endpoints are added as a palette group in Add Nodes.

## What Happens With Multi-Definition Swagger UI

If a Swagger UI page exposes multiple definitions/services:

- APIWeave discovers all available definitions.
- Endpoints from each definition are imported.
- Partial failures are reported (some definitions can fail while others still import).

## Troubleshooting

### "Select an environment before refreshing Swagger"

Choose an environment in the toolbar first.

### "Environment has no Swagger/OpenAPI URL"

Open Environment Manager and set `Swagger / OpenAPI URL`.

### "Failed to fetch Swagger URL"

- Verify URL starts with `http://` or `https://`
- Confirm the backend can reach that URL from its network
- Test with a direct spec URL if Swagger UI discovery fails

### Imported templates not updating

- Click `Refresh` again after selecting the correct environment
- Confirm environment URL is the current source-of-truth spec
