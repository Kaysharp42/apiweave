# Your First Workflow

*Build and run a real workflow in five minutes using a public, auth-free test endpoint.*

## Prerequisites

- [Installation](installation.md) completed and the APIWeave app open.
- [Concepts](concepts.md) for the basic vocabulary (workflow, node, edge, run, environment).
- No login required. The app lands directly on the workflows list.

## Build and Run in Five Steps

1. Click **New Workflow** from the sidebar or the empty-state button. A Start node is placed for you.
2. Drag an **HTTP Request** node from the palette onto the canvas. Set method to `GET` and URL to `https://httpbin.org/get` (a public, auth-free endpoint that always returns 200).
3. Drag an **Assertion** node onto the canvas. Connect the HTTP node's output to the Assertion's input. Configure the assertion: source `response.statusCode`, operator `equals`, value `200`.
4. Open the environment selector in the canvas toolbar, pick the **Default** environment, then click **Run**. Within a second or two, both nodes turn green. Click a node to see its response body and assertion result.
5. The app auto-saves your workflow about 700ms after the last edit, so the database already has the latest version when you run.

A simple login flow looks like this on the canvas:

```text
[ Start ] -> [ HTTP Request: GET /get ] -> [ Assertion ] -> [ End ]
```

## What Just Happened

- The canvas auto-saved your workflow about 700ms after the last edit. The next time you open the workflow, it loads the same shape.
- Clicking **Run** sent a typed IPC call to the main process. The `RunScheduler` picked up the run, the `WorkflowExecutor` walked the graph from Start, and progress events streamed back to the renderer over IPC.
- The green check on the Assertion node confirms `response.statusCode` equaled `200`, which is what `https://httpbin.org/get` returns.

## Adding Your First Secret

Once you have the happy path running, store a real API key in the local encrypted secret store and reference it in a second workflow. This is the canonical secret flow.

1. Open the **Secrets** page from the header.
2. Click **Add secret**, pick the **User** scope (your local store), and enter a name like `HTTPBIN_AUTH`.
3. The page shows the scope's public key fingerprint. The renderer encrypts the value against that public key with a Libsodium sealed box before the write request leaves.
4. Submit. The page now shows metadata only (name, scope, key id, last update), never the value or ciphertext.
5. Drop a second HTTP Request node on the canvas, point it at `https://httpbin.org/headers`, and add a header `Authorization: Bearer {{secrets.HTTPBIN_AUTH}}`. Run it. The header reaches the upstream service with the decrypted value, and the value never appears in the run history because the masking layer scrubs it before persistence.

The full secret model lives in [Environments and Secrets](../features/environments-and-secrets.md).

## Troubleshooting

- **If the workflows list is empty and you expected to see existing work**, you have not created any workflows yet. Click **New Workflow** to get started.
- **If Run does nothing**, the main process is not responsive. Quit the app and relaunch. If the issue persists, check the main process log (the terminal that launched Electron, or your OS console) for stack traces.
- **If the HTTP node turns red with a connection error**, your local network blocked the outbound call, or the runner's SSRF block rejected the target. Try a different public endpoint or check your proxy.
- **If the Assertion node turns red**, the status code did not match. Click the node to see the actual status, then update the assertion or use a different endpoint.
- **If the environment selector shows "no environment available"**, you have not created an environment. Open **Environments**, create one, mark it default, then re-run.
- **If a `{{secrets.X}}` placeholder shows up as plain text in the request**, the key is not declared in any scope visible to the selected environment. Open **Secrets** and add the key on the right scope.

## Related

- [Installation](installation.md)
- [Concepts](concepts.md)
- [Workflows and Nodes](../features/workflows-and-nodes.md)
- [Environments and Secrets](../features/environments-and-secrets.md)
