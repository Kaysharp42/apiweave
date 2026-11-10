# MCP Client Config Examples

These examples run the stdio launcher that ships with the APIWeave desktop app.
The client starts the launcher, and the launcher starts APIWeave in the tray when
it is not running, so the client never marks the server as disconnected.

**Requires Node.js 20 or newer** on the `PATH` the client runs with.

1. Open APIWeave once and enable the bridge under **Settings → MCP Server**.
2. Copy the launcher path shown there and replace `LAUNCHER_PATH` with it. In
   JSON, double each backslash in a Windows path.

The launcher reads the token from APIWeave's user-data folder, so these files
hold no secret. Clients that cannot run a command, or machines without Node.js,
can connect over HTTP directly instead. APIWeave must then already be running
when the client starts. See
[Client Configuration](../docs/features/mcp-integration.md#client-configuration).
