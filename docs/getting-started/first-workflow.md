# Your First Workflow

*Build and run a real workflow in five minutes using a public, auth-free test endpoint.*

## Prerequisites

- [Installation](installation.md) completed and the APIWeave app open.
- [Concepts](concepts.md) for the basic vocabulary (workflow, node, edge, run, environment).
- No login required. The app lands directly on the workflows list.

## Build and Run in Five Steps

1. Click **New Workflow** from the sidebar or the empty-state button. A **Start** node is placed for you.
2. Open the **Add Nodes** panel (the plus button at the bottom-right of the canvas) and drag a **GET Request** from the HTTP Requests section onto the canvas. Set its URL to `https://httpbin.org/get` (a public, auth-free endpoint that always returns 200). Drag from the Start node's output handle to the request's input handle to connect them.
3. Drag an **Assertion** (Validation section) onto the canvas and connect the request's output to the Assertion's input. Configure a rule: source `status`, operator `equals`, expected value `200`.
4. Drag an **End** (Control Flow section) onto the canvas and connect the Assertion's **pass** output to it.
5. Click **Run**. This endpoint needs no environment, so you can leave the toolbar's environment selector empty. Within a second or two the request and the Assertion turn green. Click a node to see its response body and assertion result.

The app auto-saves your workflow about 700ms after the last edit, so the database already has the latest version when you run.

The finished workflow looks like this on the canvas:

```text
[ Start ] -> [ GET https://httpbin.org/get ] -> [ Assertion: status equals 200 ] --pass--> [ End ]
```

## What Just Happened

- The canvas auto-saved your workflow about 700ms after the last edit. The next time you open the workflow, it loads the same shape.
- Clicking **Run** sent a typed IPC call to the main process. The `RunScheduler` picked up the run, the `WorkflowExecutor` walked the graph from Start, and progress events streamed back to the renderer over IPC.
- The green check on the Assertion node confirms the status rule passed: the response code equaled `200`, which is what `https://httpbin.org/get` returns.

## Adding Your First Secret

Once you have the happy path running, store a real API key in the local encrypted secret store and reference it in a second workflow. This is the canonical secret flow.

1. Open **Settings → Secrets** from the left navigation rail.
2. Click **Add secret**, pick the **Workspace** scope, and enter a name like `HTTPBIN_AUTH`.
3. The renderer encrypts the value against the install's public key with a Libsodium sealed box before the write request leaves.
4. Submit. The page now shows metadata only (name, scope, key id, last update), never the value or ciphertext.
5. Drop a second HTTP Request node on the canvas, point it at `https://httpbin.org/headers`, and add a header `Authorization: Bearer {{secrets.HTTPBIN_AUTH}}`. Type `{{` in the value field and an autocomplete list pops up with your variables, environment values, and secret names (secret values are never shown) — pick `secrets.HTTPBIN_AUTH` from it instead of typing the full path by hand. Run it. The header reaches the upstream service with the decrypted value, and the value never appears in the run history because the masking layer scrubs it before persistence.

The full secret model lives in [Environments and Secrets](../features/environments-and-secrets.md).

## Troubleshooting

- **If the workflows list is empty and you expected to see existing work**, you have not created any workflows yet. Click **New Workflow** to get started.
- **If Run does nothing**, the main process is not responsive. Quit the app and relaunch. If the issue persists, look for stack traces in the log file: **Settings → Updates → Show update log** opens the folder with today's `apiweave-main-YYYY-MM-DD.log` selected (see [Where Things Live](installation.md#where-things-live) for the path).
- **If the HTTP node turns red with a connection error**, your local network may have blocked the outbound call, or the endpoint may be unavailable. Check the URL and your proxy, then try again.
- **If the Assertion node turns red**, the status code did not match. Click the node to see the actual status, then update the assertion or use a different endpoint.
- **If the environment selector shows "no environment available"**, you have not created an environment. Open **Environments**, create one, then re-run. You can also pick a default in the header so it is preselected for new workflows.
- **If a `{{secrets.X}}` placeholder shows up as plain text in the request**, the key is not declared in any scope visible to the selected environment. Open **Secrets** and add the key on the right scope.

## Related

- [Installation](installation.md)
- [Concepts](concepts.md)
- [Workflows and Nodes](../features/workflows-and-nodes.md)
- [Environments and Secrets](../features/environments-and-secrets.md)
