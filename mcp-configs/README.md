# MCP Client Config Examples

These examples connect to the MCP bridge embedded in the APIWeave desktop app.
They do not start a Python process or a separate backend.

1. Start APIWeave and enable the bridge in the MCP panel.
2. Copy the live URL and access token shown by the app.
3. Replace `http://127.0.0.1:47271/mcp` if the app selected a fallback port.
4. Replace `YOUR_MCP_TOKEN` without committing the resulting file.

`claude_desktop_config.json` uses `mcp-remote` because Claude Desktop launches
local stdio commands. The other examples connect to Streamable HTTP directly.
