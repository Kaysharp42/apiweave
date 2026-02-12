# Swagger UI Base URL Integration Plan (Discover All Definitions)

Issue: users will provide a Swagger UI landing URL like `{domain}/webjars/swagger-ui/index.html` (without `.json` and without `urls.primaryName`). The app must discover all available API definitions behind that UI, fetch each spec, and import complete endpoint data.

Assumption confirmed: target URLs are reachable over VPN and currently require no auth headers/cookies.

## Phase 1 - Discovery + Evidence Baseline
- [x] Done - Reproduce current behavior using only base Swagger UI URL (`.../webjars/swagger-ui/index.html`) and confirm failure mode.
- [x] Done - Capture network/evidence of what Swagger UI itself loads (config endpoint, definitions list, selected primaryName behavior).
- [x] Done - Inventory at least 3 real URL patterns in your environment (Springdoc-style config, Swashbuckle-style config, custom UI hosting).
- [x] Done - Define expected output contract: "all definitions" means aggregate all endpoints into one imported set with per-definition metadata.
- [x] Done - Write failing backend tests for base UI URL discovery path.
- [x] Done - Run phase tests/checks.
- [x] Done - Commit Phase 1 (`test(openapi): capture swagger-ui base-url discovery failures`).

## Phase 2 - Backend Definition Discovery Engine
- [x] Done - Add backend URL classifier: `direct_spec`, `swagger_ui_index`, `swagger_config`, `unknown`.
- [x] Done - Implement Swagger UI config resolution pipeline:
- [x] Done - 1) Parse query hints (`configUrl`, `url`, `urls.primaryName`) when present.
- [x] Done - 2) Fetch index HTML and extract SwaggerUIBundle config hints (`configUrl`, `url`, `urls`).
- [x] Done - 3) Probe common config endpoints (for example relative `swagger-config`, `/v3/api-docs/swagger-config`, `/swagger/v1/swagger.json` fallback candidates).
- [x] Done - Normalize and resolve all relative URLs to absolute URLs safely using page origin/path.
- [x] Done - Return canonical discovered definitions list: `{name, specUrl, source}`.
- [x] Done - Write unit tests for classifier + resolver + relative URL normalization + fallback ordering.
- [x] Done - Run phase tests/checks.
- [x] Done - Commit Phase 2 (`feat(openapi): discover definitions from swagger-ui base url`).

## Phase 3 - Multi-definition Spec Fetch + Parse
- [x] Done - Fetch all discovered definition URLs concurrently with bounded parallelism and per-request timeouts.
- [x] Done - Parse both JSON and YAML specs robustly; validate `paths` and required OpenAPI/Swagger structure.
- [x] Done - Aggregate endpoint nodes across definitions while preserving source metadata (`definitionName`, `specUrl`, `uiUrl`).
- [x] Done - Prevent collisions by namespacing OpenAPI metadata fingerprints with definition identity.
- [x] Done - Add partial-failure handling: continue on bad definition(s), return warnings with counts (`success`, `failed`, `skipped`).
- [x] Done - Write tests for multi-definition success, partial failure, and metadata namespacing behavior.
- [x] Done - Run phase tests/checks.
- [x] Done - Commit Phase 3 (`feat(openapi): import and aggregate all discovered definitions`).

## Phase 4 - API Contract + Frontend Refresh Flow
- [x] Done - Extend `/api/workflows/import/openapi/url` response contract to include discovered definitions and aggregate stats.
- [x] Done - Update frontend refresh in `WorkflowCanvas` to handle multi-definition payloads and display accurate endpoint counts.
- [x] Done - Show import context in UI/toasts (for example: `3 definitions, 124 endpoints, 1 definition failed`).
- [x] Done - Ensure Add Nodes group labeling includes definition context (so users know endpoint origin service).
- [x] Done - Keep existing direct `.json` behavior unchanged and backward-compatible.
- [x] Done - Write frontend tests for multi-definition payload mapping and user-facing messaging.
- [x] Done - Run phase tests/checks.
- [x] Done - Commit Phase 4 (`feat(ui): render multi-definition swagger refresh results`).

## Phase 5 - Safety, Performance, and Regression Guards
- [x] Done - Add limits/guards for large installs (max definitions, max endpoints, timeout budget).
- [x] Done - Add dedupe strategy for identical endpoints across definitions (configurable: keep all vs dedupe by fingerprint).
- [x] Done - Ensure autosave/refresh interactions remain stable with larger template imports.
- [x] Done - Run one-time workflow integrity audit to verify no accidental workflow graph overwrite regressions.
- [x] Done - Write regression tests for large-definition sets and timeout/limit behavior.
- [x] Done - Run phase tests/checks.
- [x] Done - Commit Phase 5 (`test(openapi): harden multi-definition import safety and scale`).

## Phase 6 - Documentation + Rollout
- [x] Done - Document supported input URL patterns, especially plain Swagger UI index URLs.
- [x] Done - Document discovery algorithm and troubleshooting steps when definitions cannot be resolved.
- [x] Done - Add operator notes for VPN/connectivity and partial-failure interpretation.
- [x] Done - Record implementation learnings in `progress/learnings.md`.
- [x] Done - Write final integration/regression tests for end-to-end base-url flow.
- [x] Done - Run final full checks (backend tests + frontend tests/build).
- [x] Done - Commit Phase 6 (`docs(openapi): support swagger-ui base-url all-definition discovery`).

---

## Phase Exit Rule (applies to every phase)
- [x] Done - Every phase must include at least one test addition/update.
- [x] Done - Every phase must end with: tests passing -> commit created -> short note of what changed and why.
