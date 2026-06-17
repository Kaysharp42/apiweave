# Your First Workflow

*Build and run a real workflow in your personal workspace in five minutes using a public, auth-free test endpoint.*

## Prerequisites

- [Installation](installation.md) completed and `http://localhost:3000` reachable.
- [Concepts](concepts.md) for the basic vocabulary (workflow, node, edge, run, workspace, environment).
- A signed-in user. The first sign-in creates a personal workspace at the slug `personal` and lands you in its workflows list.

## Build and Run in Five Steps

1. Open `http://localhost:3000` and sign in through your configured SSO provider. The backend redirects you to `/personal/workflows`, the workflows list of your new personal workspace.
2. Click `New Workflow` from the sidebar or the empty-state button. A Start node is placed for you.
3. Drag an **HTTP Request** node from the palette onto the canvas. Set method to `GET` and URL to `https://httpbin.org/get` (a public, auth-free endpoint that always returns 200).
4. Drag an **Assertion** node onto the canvas. Connect the HTTP node's output to the Assertion's input. Configure the assertion: source `response.statusCode`, operator `equals`, value `200`.
5. Open the environment selector in the canvas toolbar, pick your workspace's default environment, then click `Run`. Within a second or two, both nodes turn green. Click a node to see its response body and assertion result.

## What Just Happened

- The canvas auto-saved your workflow about 700ms after the last edit, so the backend already has the latest version under the personal workspace.
- Clicking `Run` POSTs to the executor with the selected environment and workspace context. The executor processes nodes sequentially in a background task. The frontend polls run status at 100ms for the first two seconds, then at 1s until the run completes.
- The green check on the Assertion node confirms `response.statusCode` equaled `200`, which is what `https://httpbin.org/get` returns.

## Adding Your First Secret

Once you have the happy path running, store a real API key in a scoped secret and reference it in a second workflow. This is the canonical 2.0 secret flow.

1. Open the workspace's **Secrets** page from the header.
2. Click **Add secret**, pick the **Workspace** scope, and enter a name like `HTTPBIN_AUTH`.
3. The page shows the scope's public key fingerprint. The browser encrypts the value against that public key with a Libsodium sealed box before the request leaves.
4. Submit. The page now shows metadata only (name, scope, key id, last update), never the value or ciphertext.
5. Drop a second HTTP Request node on the canvas, point it at `https://httpbin.org/headers`, and add a header `Authorization: Bearer {{secrets.HTTPBIN_AUTH}}`. Run it. The header reaches the upstream service with the decrypted value, and the value never appears in the run history because the masking layer scrubs it before persistence.

The full secret model, including the override chain and the absence of runtime secret prompts, lives in [Environments and Secrets](../features/environments-and-secrets.md).

## Troubleshooting

- **If the redirect after sign-in does not land on `/personal/workflows`**, the database was not dropped before the first sign-in. Run the destructive reset in [Installation](installation.md#destructive-database-reset) and try again.
- **If `Run` does nothing**, the backend is not running. Start it with `start-dev.bat` (Windows) or `./start-dev.sh` (macOS/Linux).
- **If the HTTP node turns red with a connection error**, your local network blocked the outbound call, or the executor's SSRF block rejected the target. Try a different public endpoint or check your proxy.
- **If the Assertion node turns red**, the status code did not match. Click the node to see the actual status, then update the assertion or use a different endpoint.
- **If the environment selector shows "no environment available"**, your personal workspace has no default environment. Open Environments, create one, mark it default, then re-run.
- **If a `{{secrets.X}}` placeholder shows up as plain text in the request**, the key is not declared in any scope visible to the selected environment. Open Secrets and add the key on the right scope, or use a different environment.

## Related

- [Installation](installation.md)
- [Concepts](concepts.md)
- [Workflows and Nodes](../features/workflows-and-nodes.md)
- [Environments and Secrets](../features/environments-and-secrets.md)
