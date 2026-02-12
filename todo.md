# APIWeave User Documentation Rewrite Prompt

Goal: rewrite knowledge from `progress/` into clean, human-readable user documentation in `docs/`.

Use `progress/` as source learning material only. Do not reference `progress/` files in final user docs.

---

## Prompt To Follow

You are writing production user documentation for APIWeave.

Rules:
- Learn from `progress/` and code behavior, but do not cite `progress/` documents in user-facing docs.
- Write for real users first (clear, practical, low jargon, task-oriented).
- Prefer examples, step-by-step flows, and troubleshooting over implementation history.
- Remove stale/internal wording (incident notes, phase notes, migration chatter, temporary caveats).
- Keep docs consistent in tone, terms, and structure.

Deliverables:
- Update root `README.md` so it is accurate and easy to scan.
- Create `docs/README.md` as the main user docs hub.
- Create a user navigation map (`docs/NAVIGATION.md`) with "start here" paths.
- Publish user guides for:
  - workflow creation and editing
  - node usage (HTTP, assertion, delay, merge, start/end)
  - variables, extractors, and JSON editor usage
  - environments and secrets
  - collections and import/export
  - Swagger/OpenAPI import and refresh
- Add FAQ and troubleshooting docs focused on user-visible issues.

Quality bar:
- Every guide must be understandable without reading source code.
- All commands/paths/links in docs must resolve.
- Use consistent naming for features across all docs.
- Prefer concrete examples over abstract descriptions.

Validation:
- Run markdown link/file-reference checks on touched docs.
- Fix every broken link before marking complete.

Completion:
- Mark completed checklist items in this file.
- Commit in small, meaningful steps per documentation phase.

---

## Execution Checklist

### Phase 1 - Foundation
- [x] Done - Rewrite root `README.md` for current, user-first product messaging.
- [x] Done - Create `docs/README.md` as the main docs entry point.
- [x] Done - Create `docs/NAVIGATION.md` with clear start paths.
- [x] Done - Add/extend docs validation checklist and run it.
- [x] Done - Commit Phase 1.

### Phase 2 - Core User Guides
- [x] Done - Publish workflow and node usage guides.
- [x] Done - Publish variables/extractors/JSON editor guides.
- [x] Done - Publish environments/secrets and collections guides.
- [x] Done - Publish Swagger/OpenAPI user guide.
- [x] Done - Run docs checks and commit Phase 2.

### Phase 3 - Support Docs And Polish
- [ ] Not done - Add FAQ and troubleshooting documentation.
- [ ] Not done - Standardize wording and remove duplicate/conflicting pages.
- [ ] Not done - Run final docs checks (links + file refs) and fix issues.
- [ ] Not done - Commit Phase 3.
