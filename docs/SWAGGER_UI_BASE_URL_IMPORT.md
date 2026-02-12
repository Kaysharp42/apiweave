# Swagger UI Base URL Import

APIWeave can now import OpenAPI endpoints from a plain Swagger UI landing page URL (for example `https://example.internal/webjars/swagger-ui/index.html`) in addition to direct `.json` OpenAPI URLs.

## Supported Input URL Patterns

- Direct OpenAPI JSON URL (existing behavior)
  - `https://example.internal/v3/api-docs`
  - `https://example.internal/swagger/v1/swagger.json`
- Swagger UI landing URL (new behavior)
  - `https://example.internal/webjars/swagger-ui/index.html`
  - `https://example.internal/swagger-ui/index.html`
- Swagger UI URL with query hints
  - `...?configUrl=...`
  - `...?url=...`
  - `...?urls.primaryName=Asset+Service`

## Discovery Algorithm

When a Swagger UI page URL is provided, APIWeave resolves definitions using this order:

1. Parse query hints from the URL (`configUrl`, `url`, `urls.primaryName`).
2. Fetch the UI HTML and extract `SwaggerUIBundle` hints (`configUrl`, `url`, `urls[]`).
3. Probe common Swagger config endpoints if needed:
   - relative `swagger-config` near UI path
   - `/v3/api-docs/swagger-config`
   - `/api-docs/swagger-config`
   - `/swagger/v1/swagger-config`
   - `/swagger/swagger-config`
4. Normalize relative definition URLs to absolute URLs.
5. Fetch all discovered definition specs and aggregate endpoints.

## Multi-definition Behavior

- All discovered definitions are imported.
- Duplicate endpoints across services are kept (not deduped) with service context.
- Endpoint metadata includes:
  - `definitionName`
  - `definitionSpecUrl`
  - `definitionScope`
  - `sourceUiUrl`
- Fingerprints are namespaced by `definitionScope` to avoid cross-service collisions.

## Response Contract Notes

`GET /api/workflows/import/openapi/url` now returns:

- `nodes`: aggregated HTTP request nodes across imported definitions
- `definitions`: per-definition status summary (`imported`/`failed`, endpoint count)
- `stats`: aggregate totals including definition counts and failed count
- `warnings`: partial-failure details when some definitions cannot be fetched

## Safety and Performance Guards

- Definition discovery limit: 50 definitions
- Imported endpoint limit: 5000 endpoints
- Fetch timeout budget: 20 seconds per request
- Concurrent spec fetches are bounded (default: 6)

These limits prevent accidental overload on very large gateway catalogs.

## Troubleshooting

### "Could not discover OpenAPI definitions from Swagger UI URL"

- Verify the URL is the actual Swagger UI landing page.
- Open DevTools in browser and inspect which `swagger-config` endpoint is called.
- Ensure that config endpoint is reachable from backend runtime.

### "Failed to fetch any OpenAPI definitions"

- One or more discovered spec URLs may be inaccessible from backend network.
- Check DNS/VPN reachability from backend host, not only browser machine.
- Try one discovered `specUrl` directly to validate connectivity.

### YAML/OpenAPI compatibility

- JSON and YAML specs are supported.
- If YAML parsing fails, verify the upstream content is valid OpenAPI YAML.

### Partial refresh in UI

- Toasts may show a success count plus partial failure warning.
- Review `definitions` and `warnings` in backend response for exact failing services.

## Operator Notes (VPN / Connectivity)

- APIWeave backend must have network route to Swagger UI host over VPN.
- Browser access alone is not sufficient if backend runs in a different network context.
- For private gateways, verify DNS resolution and outbound HTTPS from backend environment.
