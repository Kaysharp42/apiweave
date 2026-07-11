# Cloud Link — RFC 8252 Desktop Authentication

Desktop linking flow for APIWeave Cloud. Opens a system browser to ZITADEL,
captures the OAuth callback on a random loopback port, exchanges the code for
tokens, registers the device, and encrypts the refresh token with the existing
per-installation keyfile.

## Flow

1. `startDeviceLink()` generates a PKCE S256 verifier and a random state.
2. Spawns a transient HTTP listener on `127.0.0.1:<random-port>`.
3. Opens the system browser to the ZITADEL authorize URL with the loopback
   redirect URI `http://127.0.0.1:<port>/callback`.
4. User authenticates in the browser; ZITADEL redirects to the callback.
5. Listener validates the state, extracts the authorization code.
6. Exchanges the code for tokens at ZITADEL's token endpoint (PKCE verifier).
7. Verifies the `id_token` using `jose` (local JWKS verification).
8. Calls the Go API `RegisterDevice` with the access token.
9. Encrypts the refresh token with the existing keyfile (AES-256-GCM envelope).
10. Returns the device record and encrypted credentials.

## Security Model

- **Loopback only**: Listener binds `127.0.0.1` (never `0.0.0.0`, never
  `localhost`). Port is OS-assigned (ephemeral), never hardcoded.
- **PKCE mandatory**: S256 challenge method; plain method rejected by ZITADEL.
- **State validation**: CSRF protection via random state parameter.
- **One-shot listener**: Accepts exactly one successful callback, then closes.
- **Timeout**: 5 minutes (configurable). Listener closes on timeout/cancel.
- **No embedded webview**: Uses `electron.shell.openExternal()` (system browser).
- **No plaintext tokens**: Refresh token encrypted at rest with the existing
  keyfile. No new key material is created.

## On-Disk Credential Storage

The refresh token is encrypted using the existing per-installation keyfile
(`desktop/core/secrets/keyfile.ts`):

1. A fresh 256-bit DEK is generated (`generateDek()`).
2. The refresh token is encrypted with the DEK (AES-256-GCM).
3. The DEK is wrapped by the master KEK from the keyfile (`wrapDek()`).
4. Both the encrypted blob and the wrapped DEK are returned to the caller.

The caller persists the encrypted blob and wrapped DEK (e.g., in SQLite or a
JSON file). The master KEK never leaves the keyfile; the DEK is ephemeral.

To decrypt on restart: read the keyfile, unwrap the DEK, decrypt the blob.

## Typed Errors

- `ErrLinkTimeout` — listener timed out (5 minutes).
- `ErrLinkStateMismatch` — OAuth state mismatch (CSRF attack).
- `ErrLinkBadCallback` — invalid callback (missing code/state, OAuth error).
- `ErrLinkExchangeFailed` — token exchange or device registration failed.
- `ErrLinkStoreFailed` — keyfile read or encryption failed.

## Testing

Unit tests stub ZITADEL endpoints with `http.createServer` and mock
`electron.shell.openExternal`. Run with:

```bash
cd apiweave/desktop
npx vitest run electron/cloud/__tests__/link.test.ts
```

Integration tests (Electron + Playwright) are skipped on Windows without xvfb.
