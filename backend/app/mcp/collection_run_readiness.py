"""
Collection-run backend readiness gate analysis.

This module documents the go/no-go decision for exposing collection-run MCP tools.

FINDING: NO-GO for collection-run execution exposure.
FINDING: GO for collection-run read-only exposure (list/get/latest).

Rationale:
- CollectionRun model and repository exist with stable read operations
- Collection webhook execution endpoint (POST /api/webhooks/collections/{id}/execute)
  is a PLACEHOLDER — it returns a fake collectionRunId and does not actually execute
- Exposing collection-run execution through MCP would surface broken behavior
- Read-only collection-run tools are safe: the repository provides stable list/get/latest
"""

COLLECTION_RUN_READINESS = {
    "read_tools": "GO",
    "execution_tools": "NO_GO",
    "reason": (
        "Collection webhook execution is a placeholder (see routes/webhooks.py line 722-751). "
        "It generates a fake collectionRunId without creating a CollectionRun document or "
        "executing workflows. Read-only tools are safe because the repository provides "
        "stable list/get/latest operations."
    ),
    "allowed_mcp_tools": [
        "collection_run_list",
        "collection_run_get",
        "collection_run_latest",
    ],
    "blocked_mcp_tools": [
        "collection_run_execute",
        "collection_run_trigger",
    ],
}
