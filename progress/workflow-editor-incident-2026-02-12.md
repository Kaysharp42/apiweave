# Workflow Editor Incident Report (2026-02-12)

## Scope
- Incident: JSON editor in Workflow Editor showed a default start-only graph for an existing large workflow.
- Affected workflow ID: `f56b1a3d-784e-438b-ada2-4b4cc92e11c4`.

## Reproduction Timeline
1. Open workflow in canvas.
2. Click toolbar JSON button.
3. JSON modal shows start-only graph while canvas has full workflow.
4. Edit JSON text in modal and wait; content gets reset before Apply.
5. Background PUT traffic repeats roughly every second.

## Evidence Captured
- `GET /api/workflows/f56b1a3d-784e-438b-ada2-4b4cc92e11c4` returns:
  - `nodes: 14`
  - `edges: 17`
  - `variables: 1`
- `GET /api/workflows?skip=0&limit=200` returns:
  - `total workflows: 91`
  - `start-only candidates: 15` (not automatically treated as data loss)
- Repeated network activity observed:
  - `PUT /api/workflows/{id}` every ~1 second while editor is idle.

## Root Cause
- JSON modal data source issue:
  - JSON view used a stale snapshot path in certain states, causing start-only payload display even when workflow persisted data was correct.
- JSON modal overwrite issue:
  - Modal re-seeded content from props while open, replacing in-progress edits.
- Save loop issue:
  - Save success updated tab payload, which fed new props to canvas, triggering re-hydration and autosave re-triggers.
  - Runtime polling updates also contributed to save churn when autosave was active.

## Fixes Applied
- JSON modal now seeds once per open cycle and keeps local editor state authoritative until close/apply.
- JSON payload for modal is built from live canvas state and frozen at modal-open time.
- Autosave waits for hydration completion and seeds initial snapshot without immediate save.
- Save loop mitigations:
  - remove save-path tab payload feedback writes;
  - disable autosave during run polling (`!isRunning`).
- Safety net:
  - block silent autosave if payload unexpectedly collapses to canonical start-only while hydrated baseline was non-trivial.

## Recovery/Validation Notes
- Affected workflow currently resolves with full graph (14 nodes / 17 edges).
- One-time audit helper script added:
  - `backend/tools/audit_workflow_integrity.py`
- Script highlights suspicious start-only workflows for manual review and restoration checks.

## Operator Runbook
1. Verify affected workflow payload:
   - `python -c "import json,urllib.request; wid='f56b1a3d-784e-438b-ada2-4b4cc92e11c4'; d=json.load(urllib.request.urlopen(f'http://localhost:8000/api/workflows/{wid}')); print(len(d.get('nodes',[])), len(d.get('edges',[])))"`
2. Run one-time workflow audit:
   - `python backend/tools/audit_workflow_integrity.py --base-url http://localhost:8000`
3. Investigate suspicious workflows from audit output:
   - compare with expected topology;
   - restore from exports/backups if available;
   - otherwise rebuild from source artifacts.
