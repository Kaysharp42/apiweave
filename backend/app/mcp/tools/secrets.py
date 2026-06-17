"""
MCP secret tools — REMOVED.

Old plaintext environment_set_secret and environment_delete_secret tools
have been removed as part of the GitHub-style scoped secrets refactor.

Secret management is now handled through the scoped secret API routes:
    POST /api/scopes/{scope_type}/{scope_id}/secrets
    PUT  /api/scopes/{scope_type}/{scope_id}/secrets/{secret_id}
    DELETE /api/scopes/{scope_type}/{scope_id}/secrets/{secret_id}

All writes require client-encrypted sealed-box ciphertext.
Metadata-only reads return no values/ciphertext.
"""
import logging

from mcp.server.fastmcp import FastMCP

logger = logging.getLogger(__name__)


def register_secret_tools(server: FastMCP) -> None:
    """
    No-op: old plaintext secret tools removed.

    Secret management is now through scoped API routes with
    client-encrypted writes only.
    """
    logger.info(
        "MCP secret tools: old plaintext tools removed. "
        "Use scoped secret API routes instead."
    )
