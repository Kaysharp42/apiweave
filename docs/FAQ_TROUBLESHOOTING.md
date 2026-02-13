# FAQ and Troubleshooting

Use this page when setup, imports, substitutions, or runs do not behave as expected.

## FAQ

## Why does my placeholder show up as plain text?

Common causes:

- typo in variable namespace (`{{variable.x}}` instead of `{{variables.x}}`)
- variable not defined yet
- extractor path is incorrect

## What is the difference between `env`, `variables`, `prev`, and `secrets`?

- `env.*`: environment-level values (base URLs, constants)
- `variables.*`: workflow values created manually or via extractors
- `prev.*`: previous node result (or `prev[index]` after merge)
- `secrets.*`: runtime secret values entered before run

## Does Swagger refresh overwrite my HTTP node configs?

No. Refresh updates import templates and warning metadata. Existing node request details remain yours.

## Can I use collections for execution order?

Yes, you can manage workflow order in collections. Collection webhook execution endpoint currently returns a placeholder response.

## Setup and Startup Issues

## Frontend does not load

- confirm frontend dev server is running on `http://localhost:3000`
- check `frontend/.env` and `VITE_API_URL`
- verify backend is reachable from browser

## Backend does not start

- verify Python version (`3.13+`)
- verify MongoDB is running
- check backend environment file (`backend/.env`)

## API calls fail from workflow runs

- verify URL and auth headers
- verify selected environment values
- confirm target API is reachable from backend runtime

## Variables and Extractors

## Extractor did not set value

- inspect node response body first
- update extractor path to match real response shape
- rerun workflow and check Variables panel

## Old variable value persists

- update/delete value in Variables panel
- rerun from the first relevant node in flow

## Merge branch variable lookup fails

- use branch index placeholders: `{{prev[0].response...}}`, `{{prev[1].response...}}`
- confirm merge strategy and available branch count from run results

## Swagger/OpenAPI Import and Refresh

## Refresh button reports missing environment

- select environment in toolbar first

## Refresh reports missing Swagger URL

- set `Swagger / OpenAPI URL` in Environment Manager

## Import works for direct JSON URL but not Swagger UI URL

- try the direct OpenAPI endpoint first to confirm source is valid
- ensure backend has network access to the same host/path

## Some endpoints import, some fail

- this can happen with multi-definition Swagger sources
- keep successful imports, then fix failing definition URLs upstream

## Webhooks

## Webhook returns 401

- token missing or invalid
- credentials may have been regenerated

## Webhook returns 403

- webhook is disabled

## Webhook returns 404

- webhook deleted or URL incorrect

## Logs are empty

- no execution has occurred yet
- verify trigger call and status code

## If You Still Need Help

1. Reproduce with a minimal workflow.
2. Capture request/response details from the failing node.
3. Check backend logs and run history IDs.
4. Re-run with simplified inputs to isolate one failing step.
