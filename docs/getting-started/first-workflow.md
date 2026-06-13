# Your First Workflow

*Build and run a real workflow in five minutes using a public, auth-free test endpoint.*

## Prerequisites

- [Installation](installation.md) completed and `http://localhost:3000` reachable.
- [Concepts](concepts.md) for the basic vocabulary (workflow, node, edge, run).

## Build and Run in Five Steps

1. Open `http://localhost:3000` and sign in.
2. Click `New Workflow` from the sidebar or the empty-state button.
3. Drag an **HTTP Request** node from the palette onto the canvas. Set method to `GET` and URL to `https://httpbin.org/get` (a public, auth-free endpoint that always returns 200).
4. Drag an **Assertion** node onto the canvas. Connect the HTTP node's output to the Assertion's input. Configure the assertion: source `response.statusCode`, operator `equals`, value `200`.
5. Click `Run`. Within a second or two, both nodes turn green. Click a node to see its response body and assertion result.

## What Just Happened

- The canvas auto-saved your workflow about 700ms after the last edit, so the backend already has the latest version.
- Clicking `Run` POSTs to the executor, which processes nodes sequentially in a background task. The frontend polls run status at 100ms for the first two seconds, then at 1s until the run completes.
- The green check on the Assertion node confirms `response.statusCode` equaled `200`, which is what `https://httpbin.org/get` returns.

## Troubleshooting

- **If `Run` does nothing**, the backend is not running. Start it with `start-dev.bat` (Windows) or `./start-dev.sh` (macOS/Linux).
- **If the HTTP node turns red with a connection error**, your local network blocked the outbound call. Try a different public endpoint or check your proxy.
- **If the Assertion node turns red**, the status code did not match. Click the node to see the actual status, then update the assertion or use a different endpoint.

## Related

- [Installation](installation.md)
- [Concepts](concepts.md)
- [Workflows and Nodes](../features/workflows-and-nodes.md)
