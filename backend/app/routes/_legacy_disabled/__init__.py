"""
Quarantined legacy route modules.

These routers were unmounted from main.py as part of the scoped API refactor
(Task 15). They are preserved here for reference and for test fixtures that
still exercise legacy auth/SSRF guards. Do NOT re-mount these in production.

Scoped replacements:
- workflows  -> workspaces.py (workspace-scoped workflow CRUD/run/import/export)
- environments -> scoped_environments.py (GitHub-style scoped environments)
- collections -> projects.py + workspaces.py (projects replace collections)
"""
