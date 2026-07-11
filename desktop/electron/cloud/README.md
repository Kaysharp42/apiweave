# Cloud Sync — Durable Transport

Cloud sync transport for APIWeave Cloud. Implements `SyncProvider` with a
durable outbox, cursor-based pagination, and full-resync protocol.

## Architecture

```
CloudSyncProvider (SyncProvider)
  ├─ CloudClient          Connect protocol client (fetch-based)
  ├─ DeviceTokenStore     Encrypted token storage (keyfile envelope)
  ├─ CursorStore          Per-workspace sync position (app_settings)
  └─ Outbox               Durable write-ahead log (cloud_outbox table)
```

## Outbox Lifecycle

Writes are enqueued BEFORE the network call (durable enqueue pattern):

1. Local edit occurs → `outbox.enqueue(row)` writes to `cloud_outbox` table
2. `push()` reads pending rows, batches by workspace, calls `PushDeltas`
3. On `APPLIED` or `DUPLICATE` → `outbox.markApplied(id)` deletes the row
4. On `CONFLICT` or `REJECTED` → `outbox.markFailed(id)` leaves the row pending
5. On network error → rows stay pending; next `push()` retries

Re-application is idempotent because the server uses `expected_rev` precondition.

## Cursor Semantics

The cursor is the server's ordering authority — NEVER derived from `updatedAt`.

- `cloud.cursor.<workspaceId>` — last seen cursor (int64)
- `cloud.last_rev.<workspaceId>` — last known revision (diagnostics)
- `cloud.last_full_sync.<workspaceId>` — timestamp of last full snapshot

`pull()` calls `Hello` → if `full_resync_required`, resets cursor and pulls
from zero. Otherwise, calls `PullChanges(cursor)` and paginates through changes.

## Full-Resync Protocol

When the server returns `full_resync_required: true` from `Hello`:

1. Clear the outbox (drop all pending writes)
2. Reset the cursor for each workspace
3. Pull all changes from cursor=0
4. Record the full-sync timestamp

This handles schema migrations, data corruption recovery, and protocol upgrades.

## Forbidden Payload Rejection

The desktop independently rejects payloads with `secrets` or `runs` fields,
even though the server already filters them. This prevents a compromised cloud
from pushing secret material or runtime-derived data to the desktop.

## Token Refresh

On `401 Unauthorized`, the transport pauses the push, calls the ZITADEL token
endpoint with the encrypted refresh token, and retries once. If refresh fails,
the outbox rows stay pending for the next sync cycle.

## Security

- All log lines redact tokens, codes, secrets, and ciphertext
- Refresh token encrypted with existing keyfile (no new key material)
- Forbidden payload check prevents secret material from entering the local store
- Per-record SQLite transactions ensure atomicity (rollback on error)

## Testing

```bash
cd apiweave/desktop
npx vitest run electron/cloud/__tests__/cloud-transport.test.ts
```

Tests use `nock` to mock the Connect endpoint. Coverage includes:

- Happy path: pull/pull, push, offline-edit-reconnect cycle
- Negative: network loss, expired token, stale revision, protocol mismatch
- Forbidden: server-pushed payload with secrets is rejected locally
