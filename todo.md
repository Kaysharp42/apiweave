# APIWeave Full Documentation Plan

Goal: deliver complete, production-grade documentation for APIWeave by consolidating learnings, progress artifacts, and current code behavior into a clear docs system in `docs/`.

## Phase 1 - Source Audit and Documentation Architecture
- [x] Done - Read and index all files in `progress/` (including `progress/learnings.md`) and map each to product, architecture, API, operations, or historical context.
- [x] Done - Audit current docs in `docs/` and root `README.md` for stale links, duplicate content, and missing topics.
- [x] Done - Audit backend/frontend code to build a canonical feature inventory (routes, models, runner behavior, UI modules, stores, hooks).
- [x] Done - Define documentation information architecture (top-level doc map + ownership + update cadence).
- [x] Done - Write/extend a docs validation test/checklist for this phase (at minimum: link and file reference verification for touched docs).
- [x] Done - Run phase tests/checks and record results.
- [x] Done - Commit Phase 1 (`docs(plan): define full documentation architecture from progress and code audit`).
- [x] Done - Phase note: completed source inventory + docs/code audit baseline in `docs/PHASE1_DOCUMENTATION_ARCHITECTURE.md` and validation tooling/report in `docs/link_check.py` + `docs/PHASE1_VALIDATION.md`.

## Phase 2 - Entry Points and Navigation Foundation
- [ ] Not done - Rewrite root `README.md` to match current product state, supported features, and valid doc links.
- [ ] Not done - Create `docs/README.md` as the central documentation hub with audience-based paths (user, developer, operator, contributor).
- [ ] Not done - Add a docs navigation index (`docs/NAVIGATION.md`) with quick links and “start here” sequences.
- [ ] Not done - Add a documentation versioning/change policy section (what belongs in `docs/` vs `progress/`).
- [ ] Not done - Write/extend tests/checks for nav integrity (all links resolvable, no missing targets).
- [ ] Not done - Run phase tests/checks and record results.
- [ ] Not done - Commit Phase 2 (`docs(core): rebuild README and docs navigation foundation`).

## Phase 3 - Product User Documentation (Top-of-Funnel)
- [ ] Not done - Create/refresh end-user guides for workflow creation, node usage, variables/extractors, assertions, merge behavior, and JSON editor.
- [ ] Not done - Add complete guides for environments, collections, import/export formats, and Swagger/OpenAPI sync behavior.
- [ ] Not done - Add practical workflow walkthroughs (quick start, API chain, error handling, partial failure cases).
- [ ] Not done - Add FAQ + common mistakes + troubleshooting matrix for user-facing features.
- [ ] Not done - Write/extend tests/checks for user doc examples (commands and endpoint references are valid and current).
- [ ] Not done - Run phase tests/checks and record results.
- [ ] Not done - Commit Phase 3 (`docs(user): publish complete end-user workflow documentation`).

## Phase 4 - Architecture and Developer Documentation
- [ ] Not done - Create/update architecture docs for frontend, backend, runner, MongoDB, and major data flows.
- [ ] Not done - Document core modules and extension points (contexts, stores, hooks, node system, executor pipeline).
- [ ] Not done - Add sequence diagrams for create/save/run/poll/report and OpenAPI import/refresh flow.
- [ ] Not done - Add coding conventions and “how to add a new node type/route/store pattern” guides.
- [ ] Not done - Write/extend tests/checks that validate code references in dev docs map to existing files.
- [ ] Not done - Run phase tests/checks and record results.
- [ ] Not done - Commit Phase 4 (`docs(dev): add architecture and implementation guides`).

## Phase 5 - API and Data Contract Reference
- [ ] Not done - Create comprehensive API reference in `docs/` for workflows, runs, environments, collections, webhooks, and import endpoints.
- [ ] Not done - Document request/response schemas, status/error semantics, and representative examples for each endpoint group.
- [ ] Not done - Add data model reference (collections, key fields, indexes, artifact storage behavior, GridFS notes).
- [ ] Not done - Add compatibility notes for legacy payloads and migration-sensitive fields.
- [ ] Not done - Write/extend tests/checks to verify endpoint list coverage against route files.
- [ ] Not done - Run phase tests/checks and record results.
- [ ] Not done - Commit Phase 5 (`docs(api): publish full backend API and data contract reference`).

## Phase 6 - Operations, Deployment, Security, and Runbooks
- [ ] Not done - Create deployment docs for local, Docker, and environment configuration (dev/stage/prod).
- [ ] Not done - Add operational runbooks: health checks, backups, incident triage, large-result handling, and recovery procedures.
- [ ] Not done - Add security documentation for secrets handling, filtering behavior, webhook auth model, and current limitations.
- [ ] Not done - Add performance and reliability notes (polling, autosave, import limits, safeguards).
- [ ] Not done - Write/extend tests/checks for operational docs (command validity and endpoint existence checks).
- [ ] Not done - Run phase tests/checks and record results.
- [ ] Not done - Commit Phase 6 (`docs(ops): add deployment, security, and operational runbooks`).

## Phase 7 - Documentation QA, Standardization, and Final Rollout
- [ ] Not done - Standardize writing style, terminology, frontmatter/headers, and cross-document structure.
- [ ] Not done - Resolve duplicate/conflicting content by promoting canonical docs in `docs/` and demoting historical notes to `progress/`.
- [ ] Not done - Add final “documentation coverage matrix” (feature -> doc file -> owner).
- [ ] Not done - Record implementation learnings in `progress/learnings.md` for the documentation system itself.
- [ ] Not done - Write final regression tests/checks for entire docs set (link checks + reference checks + smoke-readability checklist).
- [ ] Not done - Run final full checks and record release-ready status.
- [ ] Not done - Commit Phase 7 (`docs(complete): finalize comprehensive APIWeave documentation suite`).

---

## Phase Exit Rule (applies to every phase)
- [ ] Not done - Each phase must include at least one documentation validation test/check addition or update.
- [ ] Not done - Each phase must end with tests/checks passing, a commit, and a short phase note summarizing what changed and why.
