"""
Database initialization helper for MCP tool execution.
"""
from app import database
from app.database import connect_db


async def ensure_mcp_database() -> None:
    """Ensure Beanie is initialized before a stdio MCP tool uses repositories."""
    if database.db is not None:
        return
    await connect_db()
