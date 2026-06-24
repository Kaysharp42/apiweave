"""
MCP documentation resources — surface canonical user docs to agents.

Each resource serves a markdown file from the repo's ``docs/`` directory
verbatim. Agents call ``resources/read`` with the URI to pull the spec
on demand instead of guessing field names or grammar.
"""

import logging
from pathlib import Path

from mcp.server.fastmcp import FastMCP

logger = logging.getLogger(__name__)

# This file lives at backend/app/mcp/resources/docs.py.
# parents[4] climbs to the repo root: resources -> mcp -> app -> backend -> repo.
_REPO_ROOT = Path(__file__).resolve().parents[4]
_DOCS_DIR = _REPO_ROOT / "docs"


def _read_doc(relative_path: str) -> str:
    """Read a markdown doc from the repo's ``docs/`` directory."""
    full_path = _DOCS_DIR / relative_path
    try:
        return full_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        logger.exception("MCP doc resource not found: %s", full_path)
        return f"# error reading {relative_path}"


def register_doc_resources(server: FastMCP) -> None:
    """Register documentation resources on the MCP server."""

    @server.resource(
        "apiweave://docs/placeholders",
        name="Placeholder Grammar Reference",
        description=(
            "Four placeholder namespaces (variables, env, prev, secrets), substitution "
            "order, secret override chain, and edge cases."
        ),
        mime_type="text/markdown",
    )
    async def placeholders_doc() -> str:
        """Canonical placeholder grammar reference."""
        return _read_doc("reference/placeholders.md")

    @server.resource(
        "apiweave://docs/dynamic-functions",
        name="Dynamic Functions Reference",
        description=(
            "All 13 dynamic functions callable inside placeholders (uuid, randomString, "
            "timestamp, etc.) with signatures and examples."
        ),
        mime_type="text/markdown",
    )
    async def dynamic_functions_doc() -> str:
        """Reference for every dynamic function."""
        return _read_doc("reference/dynamic-functions.md")

    @server.resource(
        "apiweave://docs/variables-and-extractors",
        name="Variables and Extractors Guide",
        description=(
            "How to extract values from HTTP responses and pass them between nodes. "
            "Extractor shape is dict[str, str] mapping name to dot-notation path."
        ),
        mime_type="text/markdown",
    )
    async def variables_and_extractors_doc() -> str:
        """Guide for variables and HTTP-response extractors."""
        return _read_doc("features/variables-and-extractors.md")

    @server.resource(
        "apiweave://docs/workflows-and-nodes",
        name="Workflows and Nodes Guide",
        description=(
            "The seven node types (start, end, http-request, assertion, delay, merge, "
            "condition), canvas actions, resume behavior."
        ),
        mime_type="text/markdown",
    )
    async def workflows_and_nodes_doc() -> str:
        """Canonical workflow and node-type reference."""
        return _read_doc("features/workflows-and-nodes.md")

    @server.resource(
        "apiweave://docs/swagger-import",
        name="Swagger and OpenAPI Import Guide",
        description=(
            "Environment-linked Swagger/OpenAPI sync, one-time file import, "
            "the Check API warning badge, and supported versions."
        ),
        mime_type="text/markdown",
    )
    async def swagger_import_doc() -> str:
        """Canonical Swagger/OpenAPI import reference."""
        return _read_doc("features/swagger-import.md")

    @server.resource(
        "apiweave://docs/environments-and-secrets",
        name="Environments and Secrets Guide",
        description=(
            "Scoped environments, the Libsodium write-only secret model, the "
            "override chain (env > workspace > org > bound user)."
        ),
        mime_type="text/markdown",
    )
    async def environments_and_secrets_doc() -> str:
        """Guide for scoped environments and the secret override chain."""
        return _read_doc("features/environments-and-secrets.md")

    logger.info("MCP documentation resources registered")
