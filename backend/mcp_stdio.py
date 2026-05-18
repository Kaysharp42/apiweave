"""
MCP stdio entry point for local CLI/desktop agents.
Launches the same FastMCP server over stdio transport.

Usage:
    cd backend && python mcp_stdio.py

Stdio safety:
    - No print() calls before or during MCP message processing.
    - All diagnostics go to stderr via logging.
    - The .env file is loaded from the working directory.
"""
import logging
import sys
from pathlib import Path

# Ensure the backend directory is on sys.path so 'app' can be imported
backend_dir = Path(__file__).parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

# Configure logging to stderr only — stdout is the MCP message channel
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stderr,
)

logger = logging.getLogger(__name__)


def main() -> None:
    """Run the MCP server over stdio."""
    import asyncio

    from dotenv import load_dotenv

    # Load .env from the backend working directory
    load_dotenv(backend_dir / ".env")

    from app.mcp.server import mcp_server, register_tools
    from app.mcp.transport import run_stdio

    register_tools()
    logger.info("APIWeave MCP server starting in stdio mode")

    try:
        asyncio.run(run_stdio(mcp_server))
    except KeyboardInterrupt:
        logger.info("MCP stdio server interrupted")
    except Exception:
        logger.exception("MCP stdio server failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
