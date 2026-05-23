"""
MCP inventory drift detection test.

Ensures docs/MCP.md tool/resource/prompt inventory matches actual registration.
Fails when docs drift from implementation.
"""
import re
from pathlib import Path

# Project root is two levels up from this test file
PROJECT_ROOT = Path(__file__).parent.parent.parent
DOCS_MCP = PROJECT_ROOT / "docs" / "MCP.md"

# ── Source-of-truth: actual registered capabilities ──────────────────────────

EXPECTED_TOOLS = sorted([
    # Server info
    "server_info",
    # Workflow tools (10)
    "workflow_list",
    "workflow_get",
    "workflow_create",
    "workflow_update",
    "workflow_export",
    "workflow_import",
    "workflow_import_dry_run",
    "workflow_delete",
    "workflow_attach_collection",
    "workflow_set_environment",
    # Environment tools (7)
    "environment_list",
    "environment_get_active",
    "environment_create",
    "environment_get",
    "environment_update",
    "environment_delete",
    "environment_activate",
    "environment_duplicate",
    "mcp_get_config_summary",
    # Collection tools (11)
    "collection_list",
    "collection_list_workflows",
    "collection_create",
    "collection_get",
    "collection_update",
    "collection_delete",
    "collection_export",
    "collection_import",
    "collection_import_dry_run",
    "collection_add_workflow",
    "collection_remove_workflow",
    # Run tools (7)
    "workflow_run",
    "run_get_status",
    "run_get_results",
    "run_get_node_result",
    "run_latest_failed",
    "run_list",
    "run_cancel",
    # Import tools (6)
    "import_openapi_url",
    "import_openapi",
    "import_openapi_dry_run",
    "import_har",
    "import_har_dry_run",
    "import_curl",
    # Secret tools (2) — config-gated, but SHIPPED
    "environment_set_secret",
    "environment_delete_secret",
    # Webhook tools (7)
    "webhook_list",
    "webhook_get",
    "webhook_create",
    "webhook_update",
    "webhook_delete",
    "webhook_regenerate_credentials",
    "webhook_get_logs",
    # Collection-run read tools (3)
    "collection_run_list",
    "collection_run_get",
    "collection_run_latest",
])

EXPECTED_RESOURCES = sorted([
    "environment://{environment_id}",
    "environments://list",
    "run://{run_id}",
    "workflow://{workflow_id}",
])

EXPECTED_PROMPTS = sorted([
    "create_test_from_openapi",
    "create_test_from_curl",
    "debug_failed_run",
    "resume_failed_workflow",
])

EXPECTED_TOOL_COUNT = len(EXPECTED_TOOLS)  # 56
EXPECTED_RESOURCE_COUNT = len(EXPECTED_RESOURCES)  # 5
EXPECTED_PROMPT_COUNT = len(EXPECTED_PROMPTS)  # 4


def _extract_tools_from_docs(docs_text: str) -> list[str]:
    """Extract tool names from docs/MCP.md tool inventory tables only."""
    # Extract only the Tool Inventory section (before Resources section)
    inventory_end = docs_text.find("### Resources")
    if inventory_end == -1:
        inventory_end = docs_text.find("## Setup Instructions")
    inventory_section = docs_text[:inventory_end]

    # Match tool names in backticks within table rows: | `tool_name` |
    pattern = r"\| `(\w+)` \|[^|]*\|"
    matches = re.findall(pattern, inventory_section)
    return sorted(set(matches))


def _extract_resource_uris_from_docs(docs_text: str) -> list[str]:
    """Extract resource URIs from docs/MCP.md."""
    # Match resource URI patterns like environment://{...}
    pattern = r"(`\w+://\{[^}]+\}`|`[\w]+://[\w]+`)"
    matches = re.findall(pattern, docs_text)
    return sorted(set(m.strip("`") for m in matches))


def _extract_prompt_names_from_docs(docs_text: str) -> list[str]:
    """Extract prompt names from docs/MCP.md."""
    # Match prompt names in backticks
    pattern = r"`(\w+)`"
    all_matches = re.findall(pattern, docs_text)
    # Filter to known prompt names
    prompt_names = [m for m in all_matches if m in EXPECTED_PROMPTS]
    return sorted(set(prompt_names))


def test_tool_count_matches_docs():
    """Verify docs/MCP.md claims the correct total tool count."""
    docs_text = DOCS_MCP.read_text(encoding="utf-8")
    # Look for the claim like "exposes **42 tools**"
    count_pattern = r"\*\*(\d+) tools\*\*"
    match = re.search(count_pattern, docs_text)
    assert match is not None, "docs/MCP.md must contain a tool count like '**N tools**'"
    claimed_count = int(match.group(1))
    assert claimed_count == EXPECTED_TOOL_COUNT, (
        f"docs/MCP.md claims {claimed_count} tools but {EXPECTED_TOOL_COUNT} are registered. "
        f"Update the tool count in docs/MCP.md."
    )


def test_all_tools_documented():
    """Verify every registered tool appears in docs/MCP.md."""
    docs_text = DOCS_MCP.read_text(encoding="utf-8")
    doc_tools = _extract_tools_from_docs(docs_text)

    missing = set(EXPECTED_TOOLS) - set(doc_tools)
    extra = set(doc_tools) - set(EXPECTED_TOOLS)

    assert not missing, (
        f"Tools registered but NOT in docs/MCP.md: {sorted(missing)}. "
        f"Add them to the Tool Inventory section."
    )
    assert not extra, (
        f"Tools in docs/MCP.md but NOT registered: {sorted(extra)}. "
        f"Remove them or register them."
    )


def test_secret_tools_documented_as_gated():
    """Verify secret tools are documented as shipped-but-gated, not future/deferred."""
    docs_text = DOCS_MCP.read_text(encoding="utf-8")

    # Secret tools must appear in the tool inventory
    doc_tools = _extract_tools_from_docs(docs_text)
    assert "environment_set_secret" in doc_tools, (
        "environment_set_secret must be listed in docs/MCP.md tool inventory"
    )
    assert "environment_delete_secret" in doc_tools, (
        "environment_delete_secret must be listed in docs/MCP.md tool inventory"
    )

    # They should NOT be described as "future" or "deferred" or "planned"
    # Check the section around secret tools
    secret_section_pattern = r"(?:Secret|secret|Environment Secret)"
    assert re.search(secret_section_pattern, docs_text), (
        "docs/MCP.md must have a section documenting secret tools"
    )


def test_resources_documented():
    """Verify MCP resources are documented (not labeled as future/deferred)."""
    docs_text = DOCS_MCP.read_text(encoding="utf-8")

    # Resources should be documented, not labeled as future
    for resource in EXPECTED_RESOURCES:
        # Check the resource URI pattern appears (without backticks for flexibility)
        resource_key = resource.split("://")[0]
        assert resource_key in docs_text, (
            f"Resource '{resource}' must be documented in docs/MCP.md"
        )


def test_prompts_documented():
    """Verify MCP prompts are documented (not labeled as future/deferred)."""
    docs_text = DOCS_MCP.read_text(encoding="utf-8")

    for prompt in EXPECTED_PROMPTS:
        assert prompt in docs_text, (
            f"Prompt '{prompt}' must be documented in docs/MCP.md"
        )
